import type { PrismaClient } from "@prisma/client";

type DeleteResult = { ok: true } | { ok: false; error: string };

function snapshotFromTransaction(tx: {
  id: string;
  userId: string;
  walletId: string;
  categoryId: string | null;
  amountCents: number;
  direction: "in" | "out";
  currency: string;
  merchant: string | null;
  memo: string | null;
  occurredAt: Date;
  recurrence: "one_time" | "recurrent";
  status: "draft" | "pending_user" | "posted" | "rejected";
  confirmReason: string | null;
  recurrentSeriesId: string | null;
  source: string;
  importBatchId: string | null;
  rawStructuredJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: tx.id,
    userId: tx.userId,
    walletId: tx.walletId,
    categoryId: tx.categoryId,
    amountCents: tx.amountCents,
    direction: tx.direction,
    currency: tx.currency,
    merchant: tx.merchant,
    memo: tx.memo,
    occurredAt: tx.occurredAt,
    recurrence: tx.recurrence,
    status: tx.status,
    confirmReason: tx.confirmReason,
    recurrentSeriesId: tx.recurrentSeriesId,
    source: tx.source,
    importBatchId: tx.importBatchId,
    rawStructuredJson: tx.rawStructuredJson,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}

/** Move a ledger row into DeletedTransaction and remove it from the active books. */
export async function moveTransactionToDeleted(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<DeleteResult> {
  const tx = await db.transaction.findFirst({ where: { id, userId } });
  if (!tx) return { ok: false, error: "Transaction not found." };

  const alreadyDeleted = await db.deletedTransaction.findUnique({ where: { id } });
  if (alreadyDeleted && alreadyDeleted.userId !== userId) {
    return { ok: false, error: "Could not delete this transaction." };
  }

  try {
    await db.$transaction(async (trx) => {
      if (!alreadyDeleted) {
        await trx.deletedTransaction.create({ data: snapshotFromTransaction(tx) });
      }
      await trx.transaction.delete({ where: { id: tx.id } });
    });
  } catch {
    return { ok: false, error: "Could not delete this transaction." };
  }

  return { ok: true };
}

/** Copy a deleted row back onto the ledger and remove it from the deleted table. */
export async function restoreDeletedTransaction(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<DeleteResult> {
  const row = await db.deletedTransaction.findFirst({ where: { id, userId } });
  if (!row) return { ok: false, error: "Deleted transaction not found." };

  const wallet = await db.wallet.findFirst({ where: { id: row.walletId, userId }, select: { id: true } });
  if (!wallet) {
    return { ok: false, error: "The wallet for this transaction no longer exists, so it cannot be restored." };
  }

  const live = await db.transaction.findUnique({ where: { id: row.id }, select: { id: true } });
  if (live) {
    return { ok: false, error: "This transaction is already in your ledger." };
  }

  let categoryId = row.categoryId;
  if (categoryId) {
    const category = await db.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true },
    });
    if (!category) categoryId = null;
  }

  let recurrentSeriesId = row.recurrentSeriesId;
  if (recurrentSeriesId) {
    const series = await db.recurrentSeries.findFirst({
      where: { id: recurrentSeriesId, userId },
      select: { id: true },
    });
    if (!series) recurrentSeriesId = null;
  }

  let importBatchId = row.importBatchId;
  if (importBatchId) {
    const batch = await db.importBatch.findFirst({
      where: { id: importBatchId, userId },
      select: { id: true },
    });
    if (!batch) importBatchId = null;
  }

  try {
    await db.$transaction(async (trx) => {
      await trx.transaction.create({
        data: {
          id: row.id,
          userId,
          walletId: row.walletId,
          categoryId,
          amountCents: row.amountCents,
          direction: row.direction,
          currency: row.currency,
          merchant: row.merchant,
          memo: row.memo,
          occurredAt: row.occurredAt,
          recurrence: row.recurrence,
          status: row.status,
          confirmReason: row.confirmReason,
          recurrentSeriesId,
          source: row.source,
          importBatchId,
          rawStructuredJson: row.rawStructuredJson,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      });
      await trx.deletedTransaction.delete({ where: { id: row.id } });
    });
  } catch {
    return { ok: false, error: "Could not restore this transaction." };
  }

  return { ok: true };
}
