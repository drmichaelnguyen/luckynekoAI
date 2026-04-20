"use server";

import { auth } from "@/auth";
import { ensureFinanceSeed } from "@/lib/finance/seed";
import { prisma } from "@/lib/prisma";

export async function listWalletsAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  await ensureFinanceSeed(prisma, session.user.id);
  const wallets = await prisma.wallet.findMany({
    where: { userId: session.user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return { ok: true as const, wallets };
}

export async function createWalletAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 64) {
    return { ok: false as const, error: "Wallet name should be 1–64 characters." };
  }
  await ensureFinanceSeed(prisma, session.user.id);
  const maxSort = await prisma.wallet.aggregate({
    where: { userId: session.user.id },
    _max: { sortOrder: true },
  });
  await prisma.wallet.create({
    data: {
      userId: session.user.id,
      name,
      kind: "spending",
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
  return { ok: true as const };
}

export async function getPendingConfirmCountAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized", count: 0 };
  const count = await prisma.transaction.count({
    where: { userId: session.user.id, status: "pending_user" },
  });
  return { ok: true as const, count };
}

export async function listPendingTransactionsAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const rows = await prisma.transaction.findMany({
    where: { userId: session.user.id, status: "pending_user" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { wallet: true, category: true },
  });
  return {
    ok: true as const,
    rows: rows.map((t) => ({
      id: t.id,
      amountCents: t.amountCents,
      direction: t.direction,
      currency: t.currency,
      merchant: t.merchant,
      memo: t.memo,
      occurredAt: t.occurredAt.toISOString(),
      recurrence: t.recurrence,
      confirmReason: t.confirmReason,
      walletName: t.wallet.name,
      categoryName: t.category?.name ?? "Other",
    })),
  };
}

export async function confirmTransactionAction(
  id: string,
  mode: "one_time" | "start_recurring_monthly",
) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };

  const tx = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id, status: "pending_user" },
    include: { wallet: true, category: true },
  });
  if (!tx) return { ok: false as const, error: "Nothing to confirm." };

  if (mode === "one_time") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { recurrence: "one_time", status: "posted", confirmReason: null },
    });
    return { ok: true as const };
  }

  const series = await prisma.recurrentSeries.create({
    data: {
      userId: session.user.id,
      walletId: tx.walletId,
      categoryId: tx.categoryId,
      label: tx.merchant ?? tx.memo ?? "Recurring",
      cadence: "monthly",
      amountCents: tx.amountCents,
      direction: tx.direction,
      nextReminderAt: new Date(tx.occurredAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      notes: "Created from a confirmed chat or CSV import.",
    },
  });

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      recurrence: "recurrent",
      status: "posted",
      recurrentSeriesId: series.id,
      confirmReason: null,
    },
  });

  return { ok: true as const };
}

export async function rejectPendingTransactionAction(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const r = await prisma.transaction.updateMany({
    where: { id, userId: session.user.id, status: "pending_user" },
    data: { status: "rejected" },
  });
  if (r.count === 0) return { ok: false as const, error: "Not found." };
  return { ok: true as const };
}

export type TransactionDetail = {
  id: string;
  amountCents: number;
  direction: "in" | "out";
  currency: string;
  merchant: string | null;
  memo: string | null;
  occurredAt: string;
  recurrence: string;
  status: string;
  walletId: string;
  walletName: string;
  categoryId: string | null;
  categoryName: string;
  source: string;
  rawStructuredJson: string | null;
  editHistory: EditSnapshot[];
};

export type EditSnapshot = {
  editedAt: string;
  before: Partial<EditableFields>;
  after: Partial<EditableFields>;
};

export type EditableFields = {
  amountCents: number;
  direction: "in" | "out";
  currency: string;
  merchant: string | null;
  memo: string | null;
  occurredAt: string;
  walletId: string;
  categoryId: string | null;
};

export type CategoryOption = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  parentName: string | null;
};

export async function getTransactionDetailAction(id: string): Promise<
  { ok: true; tx: TransactionDetail; wallets: { id: string; name: string }[]; categories: CategoryOption[] } |
  { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const [tx, wallets, categories] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id, userId: session.user.id },
      include: { wallet: true, category: true },
    }),
    prisma.wallet.findMany({ where: { userId: session.user.id }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }], select: { id: true, name: true } }),
    prisma.category.findMany({
      where: { userId: session.user.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, parentId: true, parent: { select: { name: true } } },
    }),
  ]);
  if (!tx) return { ok: false, error: "Transaction not found." };

  let editHistory: EditSnapshot[] = [];
  try {
    if (tx.editHistoryJson) editHistory = JSON.parse(tx.editHistoryJson) as EditSnapshot[];
  } catch { /* ignore */ }

  return {
    ok: true,
    tx: {
      id: tx.id,
      amountCents: tx.amountCents,
      direction: tx.direction as "in" | "out",
      currency: tx.currency,
      merchant: tx.merchant,
      memo: tx.memo,
      occurredAt: tx.occurredAt.toISOString(),
      recurrence: tx.recurrence,
      status: tx.status,
      walletId: tx.walletId,
      walletName: tx.wallet.name,
      categoryId: tx.categoryId,
      categoryName: tx.category?.name ?? "Other",
      source: tx.source,
      rawStructuredJson: tx.rawStructuredJson,
      editHistory,
    },
    wallets,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      parentName: c.parent?.name ?? null,
    })),
  };
}

export async function updateTransactionAction(
  id: string,
  fields: EditableFields,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const existing = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) return { ok: false, error: "Not found." };

  // Build edit snapshot for training history
  const before: Partial<EditableFields> = {};
  const after: Partial<EditableFields> = {};
  const keys: (keyof EditableFields)[] = ["amountCents", "direction", "currency", "merchant", "memo", "occurredAt", "walletId", "categoryId"];
  for (const k of keys) {
    const oldVal = k === "occurredAt" ? existing.occurredAt.toISOString() : (existing[k as keyof typeof existing] as unknown);
    const newVal = fields[k] as unknown;
    if (String(oldVal) !== String(newVal ?? "")) {
      (before as Record<string, unknown>)[k] = oldVal;
      (after as Record<string, unknown>)[k] = newVal;
    }
  }

  let editHistory: EditSnapshot[] = [];
  try {
    if (existing.editHistoryJson) editHistory = JSON.parse(existing.editHistoryJson) as EditSnapshot[];
  } catch { /* ignore */ }

  if (Object.keys(after).length > 0) {
    editHistory.push({ editedAt: new Date().toISOString(), before, after });
  }

  const newOccurredAt = new Date(fields.occurredAt);
  await prisma.transaction.update({
    where: { id },
    data: {
      amountCents: Math.round(Math.abs(fields.amountCents)),
      direction: fields.direction,
      currency: fields.currency.toUpperCase(),
      merchant: fields.merchant ?? null,
      memo: fields.memo ?? null,
      occurredAt: Number.isNaN(newOccurredAt.getTime()) ? existing.occurredAt : newOccurredAt,
      walletId: fields.walletId,
      categoryId: fields.categoryId ?? null,
      editHistoryJson: editHistory.length > 0 ? JSON.stringify(editHistory) : existing.editHistoryJson,
    },
  });

  // Also update training data on linked StoredMedia if any
  if (Object.keys(after).length > 0) {
    const media = await prisma.storedMedia.findFirst({ where: { transactionId: id } });
    if (media) {
      let bundle: Record<string, unknown> = {};
      try {
        if (media.trainingExampleJson) bundle = JSON.parse(media.trainingExampleJson) as Record<string, unknown>;
      } catch { /* ignore */ }
      const edits = Array.isArray(bundle._edits) ? (bundle._edits as unknown[]) : [];
      edits.push({ editedAt: new Date().toISOString(), before, after });
      await prisma.storedMedia.update({
        where: { id: media.id },
        data: {
          trainingExampleJson: JSON.stringify({ ...bundle, _edits: edits }),
          markedForTraining: true,
        },
      });
    }
  }

  return { ok: true };
}
