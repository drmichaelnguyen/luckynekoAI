import type { FlowDirection, PrismaClient, TxRecurrence, TxStatus } from "@prisma/client";

import { findOrCreateCategory } from "@/lib/finance/category-resolver";

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

function parseOccurredAt(iso: string | null | undefined): Date {
  if (!iso) return new Date();
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
      merchant: true,
      occurredAt: true,
      currency: true,
    },
  });
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
  const category = await findOrCreateCategory({
    db,
    userId,
    label: categoryName,
    direction,
    payeeKind,
    fallbackSlug: direction === "in" ? "income" : "other",
  });
  const duplicate = await findDuplicateTransaction({
    db,
    userId,
    amountCents: amountAbsCents,
    direction,
    occurredAt,
  });
  if (duplicate) {
    return {
      saved: false,
      detail: `Skipped duplicate entry: there is already a ${duplicate.currency} ${(amountAbsCents / 100).toFixed(2)} transaction on ${duplicate.occurredAt.toISOString().slice(0, 10)}.`,
      transactionId: duplicate.id,
    };
  }

  const created = await db.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      categoryId: category?.id ?? null,
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
      : `Saved to ${wallet.name} · ${category?.parent ? `${category.parent.name} > ${category.name}` : category?.name ?? "Other"}.`;
  return { saved: true, detail, transactionId: created.id };
}

export async function persistTransactionListLedgerEntries(
  db: PrismaClient,
  userId: string,
  transactions: Record<string, unknown>[],
): Promise<{ saved: boolean; detail: string; transactionIds: string[] }> {
  const transactionIds: string[] = [];
  let savedCount = 0;
  let pendingCount = 0;
  let duplicateCount = 0;

  for (const [index, transaction] of transactions.entries()) {
    const rawStructuredJson = JSON.stringify({
      documentKind: "transaction_list_capture",
      transactionIndex: index,
      transaction,
    });
    const persisted = await persistFreeformLedgerEntry(db, userId, transaction, rawStructuredJson);
    if (!persisted.saved) {
      if (persisted.detail.includes("Skipped duplicate entry")) {
        duplicateCount += 1;
      }
      continue;
    }
    if (!persisted.transactionId) continue;
    savedCount += 1;
    transactionIds.push(persisted.transactionId);
    if (persisted.detail.includes("Saved as pending")) {
      pendingCount += 1;
    }
  }

  if (savedCount === 0) {
    return {
      saved: false,
      detail:
        duplicateCount > 0
          ? `I skipped ${duplicateCount} duplicate transaction${duplicateCount === 1 ? "" : "s"} from that screenshot, and there was nothing new to save.`
          : "I couldn't find any complete transactions to save from that screenshot.",
      transactionIds,
    };
  }

  const duplicateSuffix =
    duplicateCount > 0
      ? ` I skipped ${duplicateCount} duplicate transaction${duplicateCount === 1 ? "" : "s"} that matched the same date and amount already in your ledger.`
      : "";
  const detail =
    pendingCount > 0
      ? `Saved ${savedCount} transaction${savedCount === 1 ? "" : "s"} from the screenshot. ${pendingCount} ${pendingCount === 1 ? "needs" : "need"} confirmation in Tools → Confirm.${duplicateSuffix}`
      : `Saved ${savedCount} transaction${savedCount === 1 ? "" : "s"} from the screenshot.${duplicateSuffix}`;

  return { saved: true, detail, transactionIds };
}
