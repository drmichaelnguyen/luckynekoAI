import type { FlowDirection, PrismaClient, TxRecurrence, TxStatus } from "@prisma/client";

import { findOrCreateCategory } from "@/lib/finance/category-resolver";

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function normalizeAmountString(raw: string, currencyHint?: string | null): string | null {
  const compact = raw
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[$€£¥₫đ]/gi, "")
    .replace(/[A-Za-z]+/g, "");

  if (!/[0-9]/.test(compact)) return null;

  const negative =
    compact.startsWith("-") ||
    (compact.startsWith("(") && compact.endsWith(")"));

  let digits = compact.replace(/[()\-+]/g, "");
  if (!/[0-9]/.test(digits)) return null;

  const upperCurrency = currencyHint?.trim().toUpperCase() ?? "";
  const integerCurrency = upperCurrency === "VND";
  const commaCount = (digits.match(/,/g) ?? []).length;
  const dotCount = (digits.match(/\./g) ?? []).length;

  let decimalSeparator: "," | "." | null = null;

  if (commaCount > 0 && dotCount > 0) {
    decimalSeparator = digits.lastIndexOf(".") > digits.lastIndexOf(",") ? "." : ",";
  } else if (commaCount > 0 || dotCount > 0) {
    const candidate = commaCount > 0 ? "," : ".";
    const count = candidate === "," ? commaCount : dotCount;
    const idx = digits.lastIndexOf(candidate);
    const digitsAfter = digits.length - idx - 1;
    if (!integerCurrency && digitsAfter > 0 && digitsAfter <= 2) {
      decimalSeparator = candidate;
    } else if (!integerCurrency && count > 1 && digitsAfter > 0 && digitsAfter <= 2) {
      decimalSeparator = candidate;
    }
  }

  if (decimalSeparator) {
    const lastDecimalIndex = digits.lastIndexOf(decimalSeparator);
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    digits = digits.replace(new RegExp(`\\${thousandsSeparator}`, "g"), "");
    digits = digits
      .split("")
      .map((char, index) => {
        if (char !== decimalSeparator) return char;
        return index === lastDecimalIndex ? "." : "";
      })
      .join("");
  } else {
    digits = digits.replace(/[,.]/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return `${negative ? "-" : ""}${digits}`;
}

function asNumber(v: unknown, currencyHint?: string | null): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const normalized = normalizeAmountString(v, currencyHint);
    if (!normalized) return null;
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseOccurredAt(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  // Date-only strings (YYYY-MM-DD) are parsed as UTC by JS, shifting by timezone.
  // Append noon local time to keep the date stable across all timezones.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim()) ? `${iso.trim()}T12:00:00` : iso;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function findDuplicateTransaction(args: {
  db: PrismaClient;
  userId: string;
  amountCents: number;
  direction: FlowDirection;
  occurredAt: Date;
}) {
  const { start, end } = dayBounds(args.occurredAt);
  return args.db.transaction.findFirst({
    where: {
      userId: args.userId,
      amountCents: args.amountCents,
      direction: args.direction,
      occurredAt: {
        gte: start,
        lte: end,
      },
      status: { not: "rejected" },
    },
    select: {
      id: true,
      currency: true,
      occurredAt: true,
    },
  });
}

/** Try multiple date fields in priority order; fall back to today only if all are null. */
function resolveDate(...candidates: (string | null | undefined)[]): Date {
  for (const c of candidates) {
    if (c) {
      const d = parseOccurredAt(c);
      if (d.getFullYear() > 2000) return d;
    }
  }
  return new Date();
}

function lineItemsMemo(receipt: Record<string, unknown>): string | null {
  const items = receipt.lineItems;
  if (!Array.isArray(items) || items.length === 0) return null;
  const currency = asString(receipt.currency);
  const parts: string[] = [];
  for (const row of items.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const d = asString(o.description);
    const lt = asNumber(o.lineTotal, currency);
    if (d || lt != null) parts.push(d ? `${d}${lt != null ? ` ${lt}` : ""}` : `${lt}`);
  }
  const s = parts.join("; ");
  return s.length > 0 ? s.slice(0, 1900) : null;
}

/** Persist a receipt as a one-time expense transaction (chat / document-import path). */
export async function persistReceiptLedgerEntry(
  db: PrismaClient,
  userId: string,
  receipt: Record<string, unknown>,
  rawStructuredJson: string,
): Promise<{ saved: boolean; detail: string; transactionId?: string }> {
  const currency = asString(receipt.currency);
  const total = asNumber(receipt.total, currency);
  if (total === null || total === 0) {
    return { saved: false, detail: "Receipt total is missing or zero.", transactionId: undefined };
  }

  const amountAbsCents = Math.round(Math.abs(total) * 100);
  if (amountAbsCents <= 0) {
    return { saved: false, detail: "Invalid receipt total.", transactionId: undefined };
  }

  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  const wallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  if (!wallet) {
    return { saved: false, detail: "No wallet configured.", transactionId: undefined };
  }

  const merchant = asString(receipt.merchant);
  const category = await findOrCreateCategory({
    db,
    userId,
    label: "Other",
    direction: "out",
    fallbackSlug: "other",
  });
  const occurredAt = resolveDate(asString(receipt.purchaseDate), asString(receipt.date), asString(receipt.transactionDate));
  const duplicate = await findDuplicateTransaction({
    db,
    userId,
    amountCents: amountAbsCents,
    direction: "out",
    occurredAt,
  });
  if (duplicate) {
    return {
      saved: false,
      detail: `Skipped duplicate receipt: there is already a ${duplicate.currency} ${(amountAbsCents / 100).toFixed(2)} expense on ${duplicate.occurredAt.toISOString().slice(0, 10)}.`,
      transactionId: duplicate.id,
    };
  }
  const tax = asNumber(receipt.taxTotal, currency);
  const sub = asNumber(receipt.subtotal, currency);
  const memoParts = [
    lineItemsMemo(receipt),
    tax != null ? `Tax: ${tax}` : null,
    sub != null ? `Subtotal: ${sub}` : null,
    asString(receipt.paymentMethod) ? `Payment: ${asString(receipt.paymentMethod)}` : null,
  ].filter(Boolean);
  const memo = memoParts.join(" · ").slice(0, 4000) || null;

  const created = await db.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      categoryId: category?.id ?? null,
      amountCents: amountAbsCents,
      direction: "out" as FlowDirection,
      currency: currency?.toUpperCase() ?? "CAD",
      merchant,
      memo,
      occurredAt,
      recurrence: "one_time" as TxRecurrence,
      status: "posted" as TxStatus,
      confirmReason: null,
      source: "chat_receipt",
      rawStructuredJson,
    },
  });

  return {
    saved: true,
    detail: `Saved receipt to ${wallet.name} · ${merchant ?? "Expense"} · ${(total).toFixed(2)} ${currency?.toUpperCase() ?? "CAD"}.`,
    transactionId: created.id,
  };
}

/** Persist net pay from a payroll document as income (best-effort single line). */
export async function persistPaystubLedgerEntry(
  db: PrismaClient,
  userId: string,
  paystub: Record<string, unknown>,
  rawStructuredJson: string,
): Promise<{ saved: boolean; detail: string; transactionId?: string }> {
  const currency = asString(paystub.currency);
  const net = asNumber(paystub.netPay, currency);
  if (net === null || net === 0) {
    return { saved: false, detail: "Net pay is missing or zero on this paystub.", transactionId: undefined };
  }

  const amountAbsCents = Math.round(Math.abs(net) * 100);
  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  const wallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  if (!wallet) {
    return { saved: false, detail: "No wallet configured.", transactionId: undefined };
  }

  const employer = asString(paystub.employerName);
  const category = await findOrCreateCategory({
    db,
    userId,
    label: employer ? `Income > ${employer}` : "Income",
    direction: "in",
    fallbackSlug: "income",
  });
  // Prefer the actual pay date, then period end, then period start
  const occurredAt = resolveDate(
    asString(paystub.payDate),
    asString(paystub.payPeriodEnd),
    asString(paystub.payPeriodStart),
  );
  const duplicate = await findDuplicateTransaction({
    db,
    userId,
    amountCents: amountAbsCents,
    direction: "in",
    occurredAt,
  });
  if (duplicate) {
    return {
      saved: false,
      detail: `Skipped duplicate paystub: there is already a ${duplicate.currency} ${(amountAbsCents / 100).toFixed(2)} income entry on ${duplicate.occurredAt.toISOString().slice(0, 10)}.`,
      transactionId: duplicate.id,
    };
  }
  const gross = asNumber(paystub.grossPay, currency);
  const memo = [
    gross != null ? `Gross: ${gross}` : null,
    currency ? `Currency: ${currency}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 4000);

  const created = await db.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      categoryId: category?.id ?? null,
      amountCents: amountAbsCents,
      direction: "in" as FlowDirection,
      currency: currency?.toUpperCase() ?? "CAD",
      merchant: employer,
      memo: memo || "Paystub net pay",
      occurredAt,
      recurrence: "one_time" as TxRecurrence,
      status: "posted" as TxStatus,
      confirmReason: null,
      source: "chat_paystub",
      rawStructuredJson,
    },
  });

  return {
    saved: true,
    detail: `Saved paystub net pay to ${wallet.name} · ${employer ?? "Employer"} · net ${net.toFixed(2)}.`,
    transactionId: created.id,
  };
}
