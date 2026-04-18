import type { FlowDirection, PrismaClient, TxRecurrence, TxStatus } from "@prisma/client";

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseOccurredAt(iso: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function lineItemsMemo(receipt: Record<string, unknown>): string | null {
  const items = receipt.lineItems;
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts: string[] = [];
  for (const row of items.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const d = asString(o.description);
    const lt = asNumber(o.lineTotal);
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
  const total = asNumber(receipt.total);
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

  const categories = await db.category.findMany({ where: { userId } });
  const other = categories.find((c) => c.slug === "other");
  const categoryId = other?.id ?? null;

  const merchant = asString(receipt.merchant);
  const occurredAt = parseOccurredAt(asString(receipt.purchaseDate));
  const tax = asNumber(receipt.taxTotal);
  const sub = asNumber(receipt.subtotal);
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
      categoryId,
      amountCents: amountAbsCents,
      direction: "out" as FlowDirection,
      currency: asString(receipt.currency)?.toUpperCase() ?? "CAD",
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
    detail: `Saved receipt to ${wallet.name} · ${merchant ?? "Expense"} · ${(total).toFixed(2)} ${asString(receipt.currency)?.toUpperCase() ?? "CAD"}.`,
    transactionId: created.id,
  };
}

/** Persist net pay from a Canadian paystub as income (best-effort single line). */
export async function persistPaystubLedgerEntry(
  db: PrismaClient,
  userId: string,
  paystub: Record<string, unknown>,
  rawStructuredJson: string,
): Promise<{ saved: boolean; detail: string; transactionId?: string }> {
  const net = asNumber(paystub.netPay);
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

  const categories = await db.category.findMany({ where: { userId } });
  const income =
    categories.find((c) => c.kind === "income") ??
    categories.find((c) => c.slug === "other") ??
    categories[0];
  const categoryId = income?.id ?? null;

  const employer = asString(paystub.employerName);
  const periodEnd = asString(paystub.payPeriodEnd) ?? asString(paystub.payPeriodStart);
  const occurredAt = parseOccurredAt(periodEnd);
  const gross = asNumber(paystub.grossPay);
  const memo = [
    gross != null ? `Gross: ${gross}` : null,
    asString(paystub.currency) ? `Currency: ${asString(paystub.currency)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 4000);

  const created = await db.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      categoryId,
      amountCents: amountAbsCents,
      direction: "in" as FlowDirection,
      currency: asString(paystub.currency)?.toUpperCase() ?? "CAD",
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
