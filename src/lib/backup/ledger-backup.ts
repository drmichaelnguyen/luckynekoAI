import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const BACKUP_VERSION = 1 as const;

const WalletKindEnum = z.enum(["spending", "savings", "credit", "other"]);
const CategoryKindEnum = z.enum(["income", "expense", "transfer"]);
const FlowDirectionEnum = z.enum(["in", "out"]);
const TxRecurrenceEnum = z.enum(["one_time", "recurrent"]);
const TxStatusEnum = z.enum(["draft", "pending_user", "posted", "rejected"]);
const RecurrentCadenceEnum = z.enum(["weekly", "monthly", "yearly", "irregular"]);

const WalletRow = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  kind: WalletKindEnum,
  currency: z.string().min(3).max(3),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CategoryRow = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  kind: CategoryKindEnum,
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ImportBatchRow = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  rowCount: z.number().int().nonnegative(),
  status: z.string().min(1).max(64),
  createdAt: z.string(),
});

const RecurrentSeriesRow = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  categoryId: z.string().nullable(),
  label: z.string().min(1).max(200),
  cadence: RecurrentCadenceEnum,
  amountCents: z.number().int(),
  direction: FlowDirectionEnum,
  nextReminderAt: z.string().nullable(),
  isPaused: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const TransactionRow = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  categoryId: z.string().nullable(),
  amountCents: z.number().int(),
  direction: FlowDirectionEnum,
  currency: z.string().min(1).max(3),
  merchant: z.string().nullable(),
  memo: z.string().nullable(),
  occurredAt: z.string(),
  recurrence: TxRecurrenceEnum,
  status: TxStatusEnum,
  confirmReason: z.string().nullable(),
  recurrentSeriesId: z.string().nullable(),
  source: z.string().min(1).max(64),
  importBatchId: z.string().nullable(),
  rawStructuredJson: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LedgerBackupSchema = z.object({
  version: z.literal(1),
  app: z.literal("neko-zeni"),
  exportedAt: z.string(),
  email: z.string().email(),
  preferredCurrency: z.string().min(3).max(3),
  onboardingCompleted: z.boolean(),
  wallets: z.array(WalletRow).min(1).max(20),
  categories: z.array(CategoryRow).min(1).max(200),
  importBatches: z.array(ImportBatchRow).max(5000),
  recurrentSeries: z.array(RecurrentSeriesRow).max(2000),
  transactions: z.array(TransactionRow).max(50_000),
});

export type LedgerBackup = z.infer<typeof LedgerBackupSchema>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function buildLedgerBackupJson(
  db: PrismaClient,
  userId: string,
  email: string,
): Promise<{ json: string; filename: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { preferredCurrency: true, onboardingCompleted: true },
  });
  if (!user) throw new Error("User not found");

  const [wallets, categories, importBatches, recurrentSeries, transactions] = await Promise.all([
    db.wallet.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    db.category.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    db.importBatch.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.recurrentSeries.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.transaction.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } }),
  ]);

  const payload: LedgerBackup = {
    version: BACKUP_VERSION,
    app: "neko-zeni",
    exportedAt: new Date().toISOString(),
    email: email.toLowerCase(),
    preferredCurrency: user.preferredCurrency.toUpperCase().slice(0, 3),
    onboardingCompleted: user.onboardingCompleted,
    wallets: wallets.map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      currency: w.currency,
      isDefault: w.isDefault,
      sortOrder: w.sortOrder,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      kind: c.kind,
      sortOrder: c.sortOrder,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    importBatches: importBatches.map((b) => ({
      id: b.id,
      label: b.label,
      rowCount: b.rowCount,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    })),
    recurrentSeries: recurrentSeries.map((r) => ({
      id: r.id,
      walletId: r.walletId,
      categoryId: r.categoryId,
      label: r.label,
      cadence: r.cadence,
      amountCents: r.amountCents,
      direction: r.direction,
      nextReminderAt: r.nextReminderAt ? r.nextReminderAt.toISOString() : null,
      isPaused: r.isPaused,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      walletId: t.walletId,
      categoryId: t.categoryId,
      amountCents: t.amountCents,
      direction: t.direction,
      currency: t.currency,
      merchant: t.merchant,
      memo: t.memo,
      occurredAt: t.occurredAt.toISOString(),
      recurrence: t.recurrence,
      status: t.status,
      confirmReason: t.confirmReason,
      recurrentSeriesId: t.recurrentSeriesId,
      source: t.source,
      importBatchId: t.importBatchId,
      rawStructuredJson: t.rawStructuredJson,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const filename = `neko-zeni-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return { json, filename };
}

function assertReferentialIntegrity(data: LedgerBackup): string | null {
  const walletIds = new Set(data.wallets.map((w) => w.id));
  const categoryIds = new Set(data.categories.map((c) => c.id));
  const batchIds = new Set(data.importBatches.map((b) => b.id));
  const seriesIds = new Set(data.recurrentSeries.map((s) => s.id));

  for (const s of data.recurrentSeries) {
    if (!walletIds.has(s.walletId)) return `RecurrentSeries ${s.id} references unknown wallet.`;
    if (s.categoryId && !categoryIds.has(s.categoryId)) return `RecurrentSeries ${s.id} references unknown category.`;
  }
  for (const t of data.transactions) {
    if (!walletIds.has(t.walletId)) return `Transaction ${t.id} references unknown wallet.`;
    if (t.categoryId && !categoryIds.has(t.categoryId)) return `Transaction ${t.id} references unknown category.`;
    if (t.importBatchId && !batchIds.has(t.importBatchId)) return `Transaction ${t.id} references unknown import batch.`;
    if (t.recurrentSeriesId && !seriesIds.has(t.recurrentSeriesId)) {
      return `Transaction ${t.id} references unknown recurrent series.`;
    }
  }
  return null;
}

export async function restoreLedgerBackupForUser(
  db: PrismaClient,
  args: { targetUserId: string; backup: LedgerBackup; expectedEmail: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = args.backup.email.toLowerCase().trim();
  if (email !== args.expectedEmail.toLowerCase().trim()) {
    return {
      ok: false,
      error:
        "This backup belongs to a different email address. Sign in with that account, or only restore files you exported yourself while signed in here.",
    };
  }

  const integrity = assertReferentialIntegrity(args.backup);
  if (integrity) return { ok: false, error: integrity };

  const uid = args.targetUserId;
  const b = args.backup;

  await db.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { userId: uid } });
    await tx.recurrentSeries.deleteMany({ where: { userId: uid } });
    await tx.importBatch.deleteMany({ where: { userId: uid } });
    await tx.wallet.deleteMany({ where: { userId: uid } });
    await tx.category.deleteMany({ where: { userId: uid } });

    for (const part of chunk(b.categories, 200)) {
      await tx.category.createMany({
        data: part.map((c) => ({
          id: c.id,
          userId: uid,
          name: c.name,
          slug: c.slug,
          kind: c.kind,
          sortOrder: c.sortOrder,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        })),
      });
    }

    for (const part of chunk(b.wallets, 50)) {
      await tx.wallet.createMany({
        data: part.map((w) => ({
          id: w.id,
          userId: uid,
          name: w.name,
          kind: w.kind,
          currency: w.currency.toUpperCase().slice(0, 3),
          isDefault: w.isDefault,
          sortOrder: w.sortOrder,
          createdAt: new Date(w.createdAt),
          updatedAt: new Date(w.updatedAt),
        })),
      });
    }

    for (const part of chunk(b.importBatches, 200)) {
      await tx.importBatch.createMany({
        data: part.map((row) => ({
          id: row.id,
          userId: uid,
          label: row.label,
          rowCount: row.rowCount,
          status: row.status,
          createdAt: new Date(row.createdAt),
        })),
      });
    }

    for (const part of chunk(b.recurrentSeries, 200)) {
      await tx.recurrentSeries.createMany({
        data: part.map((r) => ({
          id: r.id,
          userId: uid,
          walletId: r.walletId,
          categoryId: r.categoryId,
          label: r.label,
          cadence: r.cadence,
          amountCents: r.amountCents,
          direction: r.direction,
          nextReminderAt: r.nextReminderAt ? new Date(r.nextReminderAt) : null,
          isPaused: r.isPaused,
          notes: r.notes,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        })),
      });
    }

    for (const part of chunk(b.transactions, 200)) {
      await tx.transaction.createMany({
        data: part.map((t) => ({
          id: t.id,
          userId: uid,
          walletId: t.walletId,
          categoryId: t.categoryId,
          amountCents: t.amountCents,
          direction: t.direction,
          currency: t.currency.toUpperCase().slice(0, 3),
          merchant: t.merchant,
          memo: t.memo,
          occurredAt: new Date(t.occurredAt),
          recurrence: t.recurrence,
          status: t.status,
          confirmReason: t.confirmReason,
          recurrentSeriesId: t.recurrentSeriesId,
          source: t.source,
          importBatchId: t.importBatchId,
          rawStructuredJson: t.rawStructuredJson,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })),
      });
    }

    await tx.user.update({
      where: { id: uid },
      data: {
        preferredCurrency: b.preferredCurrency.toUpperCase().slice(0, 3),
        onboardingCompleted: b.onboardingCompleted,
      },
    });
  });

  return { ok: true };
}

export function parseLedgerBackupJson(text: string): { ok: true; data: LedgerBackup } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  const parsed = LedgerBackupSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Backup format is invalid or from an unsupported version." };
  }
  return { ok: true, data: parsed.data };
}
