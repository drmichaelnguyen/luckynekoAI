import type { FlowDirection, PrismaClient, TxRecurrence, TxStatus } from "@prisma/client";

import { slugify } from "@/lib/finance/slug";

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

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function parseOccurredAt(iso: string | null): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export async function persistFreeformLedgerEntry(
  db: PrismaClient,
  userId: string,
  transaction: Record<string, unknown>,
  rawStructuredJson: string,
): Promise<{ saved: boolean; detail: string; transactionId?: string }> {
  const amountRaw = asNumber(transaction.amount);
  if (amountRaw === null || amountRaw === 0) {
    return { saved: false, detail: "", transactionId: undefined };
  }

  const amountAbsCents = Math.round(Math.abs(amountRaw) * 100);
  if (amountAbsCents <= 0) {
    return { saved: false, detail: "", transactionId: undefined };
  }

  let direction: FlowDirection = "out";
  const dirRaw = asString(transaction.direction)?.toLowerCase();
  if (dirRaw === "in" || dirRaw === "income") direction = "in";
  else if (dirRaw === "out" || dirRaw === "expense" || dirRaw === "debit") direction = "out";
  else if (amountRaw < 0) direction = "out";
  else {
    const kind = asString(transaction.transactionKind)?.toLowerCase();
    if (kind === "income" || kind === "credit" || kind === "deposit") direction = "in";
  }

  const walletLabel = asString(transaction.walletLabel) ?? asString(transaction.wallet);
  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  if (!defaultWallet) {
    return { saved: false, detail: "No wallet configured.", transactionId: undefined };
  }
  let wallet = defaultWallet;
  if (walletLabel) {
    const hit = wallets.find(
      (w) => w.name.toLowerCase() === walletLabel.toLowerCase() || w.name.toLowerCase().includes(walletLabel.toLowerCase()),
    );
    if (hit) wallet = hit;
  }

  const categoryName = asString(transaction.category) ?? asString(transaction.categoryName);
  const categories = await db.category.findMany({ where: { userId } });
  const other = categories.find((c) => c.slug === "other");
  let categoryId: string | null = other?.id ?? null;
  if (categoryName) {
    const hit = categories.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase() || c.slug === slugify(categoryName),
    );
    if (hit) categoryId = hit.id;
  }

  const recurrenceRaw = asString(transaction.recurrence)?.toLowerCase();
  let recurrence: TxRecurrence = "one_time";
  if (recurrenceRaw === "recurrent" || recurrenceRaw === "recurring" || recurrenceRaw === "subscription") {
    recurrence = "recurrent";
  }

  const payeeKind = asString(transaction.payeeKind)?.toLowerCase() ?? "";
  const needsFlag = asBool(transaction.needsUserConfirm);
  const needsUserConfirm =
    needsFlag === true ||
    recurrence === "recurrent" ||
    ["bill", "loan", "subscription", "utility"].some((k) => payeeKind.includes(k));

  const status: TxStatus = needsUserConfirm ? "pending_user" : "posted";
  const confirmReason =
    asString(transaction.userConfirmReason) ??
    asString(transaction.confirmReason) ??
    (needsUserConfirm ? "Please confirm if this repeats (bill / loan / subscription)." : null);

  const merchant = asString(transaction.merchant);
  const notes = asString(transaction.notes);
  const occurredAt = parseOccurredAt(asString(transaction.transactionDate) ?? asString(transaction.occurredAt));

  const created = await db.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      categoryId,
      amountCents: amountAbsCents,
      direction,
      currency: asString(transaction.currency)?.toUpperCase() ?? "CAD",
      merchant,
      memo: notes,
      occurredAt,
      recurrence,
      status,
      confirmReason,
      source: "chat",
      rawStructuredJson,
    },
  });

  const detail =
    status === "pending_user"
      ? `Saved as pending (${wallet.name}) — open Tools → Confirm to say if it repeats.`
      : `Saved to ${wallet.name} · ${categoryName ?? "Other"}.`;
  return { saved: true, detail, transactionId: created.id };
}
