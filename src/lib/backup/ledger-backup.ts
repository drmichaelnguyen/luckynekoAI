import type { PrismaClient } from "@prisma/client";

import { findUserForLedgerBackupHeader } from "@/lib/prisma/user-select-compat";
import { strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";

import { extForMime, readUserMediaFile } from "@/lib/media/user-media-storage";

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
  customCadence: z.string().max(200).nullable().optional(),
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

const StoredMediaBackupRow = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1).max(120),
  originalFilename: z.string().min(1).max(240),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().min(32).max(128),
  createdAt: z.string(),
  source: z.string().max(32),
  chatTurnId: z.string().nullable(),
  documentKind: z.string().max(64).nullable(),
  transactionId: z.string().nullable(),
  trainingOptIn: z.boolean(),
  structuredExcerpt: z.string().max(8000).nullable(),
  pendingImportJson: z.string().max(500_000).nullable().optional(),
  trainingExampleJson: z.string().max(500_000).nullable().optional(),
  markedForTraining: z.boolean().optional(),
  zipEntryPath: z.string().min(1).max(500),
});

const PlanKindEnum = z.enum(["spending_budget", "savings_goal"]);
const PlanPeriodEnum = z.enum(["none", "weekly", "monthly", "yearly"]);

const FinancialPlanBackupRow = z.object({
  id: z.string().min(1),
  kind: PlanKindEnum,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  amountCents: z.number().int().nonnegative().nullable(),
  currency: z.string().min(3).max(3),
  period: PlanPeriodEnum,
  targetDate: z.string().nullable(),
  sortOrder: z.number().int(),
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
  profileName: z.string().max(200).nullable().optional(),
  profileNickname: z.string().max(80).nullable().optional(),
  wallets: z.array(WalletRow).min(1).max(20),
  categories: z.array(CategoryRow).min(1).max(200),
  importBatches: z.array(ImportBatchRow).max(5000),
  recurrentSeries: z.array(RecurrentSeriesRow).max(2000),
  transactions: z.array(TransactionRow).max(50_000),
  storedMedia: z.array(StoredMediaBackupRow).max(5000).optional(),
  financialPlans: z.array(FinancialPlanBackupRow).max(500).optional(),
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
  const user = await findUserForLedgerBackupHeader(db, userId);

  const [wallets, categories, importBatches, recurrentSeries, transactions, financialPlans] = await Promise.all([
    db.wallet.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    db.category.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    db.importBatch.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.recurrentSeries.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.transaction.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } }),
    db.financialPlan.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  const payload: LedgerBackup = {
    version: BACKUP_VERSION,
    app: "neko-zeni",
    exportedAt: new Date().toISOString(),
    email: email.toLowerCase(),
    preferredCurrency: user.preferredCurrency.toUpperCase().slice(0, 3),
    onboardingCompleted: user.onboardingCompleted,
    profileName: user.name ?? null,
    profileNickname: user.nickname ?? null,
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
      customCadence: r.customCadence,
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
    financialPlans: financialPlans.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      amountCents: p.amountCents,
      currency: p.currency,
      period: p.period,
      targetDate: p.targetDate ? p.targetDate.toISOString().slice(0, 10) : null,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const filename = `neko-zeni-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return { json, filename };
}

/** ZIP: `ledger.json` (ledger + `storedMedia` manifest), `training_manifest.json`, and `media/*` bytes. */
export async function buildLedgerBackupZip(
  db: PrismaClient,
  userId: string,
  email: string,
): Promise<{ buffer: Uint8Array; filename: string }> {
  const { json } = await buildLedgerBackupJson(db, userId, email);
  const base = JSON.parse(json) as LedgerBackup;

  const mediaRows = await db.storedMedia.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  const storedMedia = mediaRows.map((m) => {
    const zipEntryPath = `media/${m.id}${extForMime(m.mimeType)}`;
    return {
      id: m.id,
      mimeType: m.mimeType,
      originalFilename: m.originalFilename,
      byteSize: m.byteSize,
      sha256: m.sha256,
      createdAt: m.createdAt.toISOString(),
      source: m.source,
      chatTurnId: m.chatTurnId,
      documentKind: m.documentKind,
      transactionId: m.transactionId,
      trainingOptIn: m.trainingOptIn,
      structuredExcerpt: m.structuredExcerpt,
      pendingImportJson: m.pendingImportJson,
      trainingExampleJson: m.trainingExampleJson,
      markedForTraining: m.markedForTraining,
      zipEntryPath,
    };
  });

  const payload: LedgerBackup = { ...base, storedMedia };

  const trainingManifest = {
    version: 1 as const,
    app: "neko-zeni",
    exportedAt: payload.exportedAt,
    purpose:
      "Label manifest for optional future model training; images and PDFs are under media/. Only rows with trainingOptIn true are intended for external training use.",
    items: storedMedia.map((m) => ({
      id: m.id,
      zipEntryPath: m.zipEntryPath,
      mimeType: m.mimeType,
      originalFilename: m.originalFilename,
      documentKind: m.documentKind,
      trainingOptIn: m.trainingOptIn,
      transactionId: m.transactionId,
      markedForTraining: m.markedForTraining,
    })),
  };

  const zipMap: Record<string, Uint8Array> = {
    "ledger.json": strToU8(JSON.stringify(payload, null, 2)),
    "training_manifest.json": strToU8(JSON.stringify(trainingManifest, null, 2)),
  };

  for (const m of mediaRows) {
    const zipEntryPath = `media/${m.id}${extForMime(m.mimeType)}`;
    const fileBuf = await readUserMediaFile(m.relativePath);
    if (fileBuf?.length) {
      zipMap[zipEntryPath] = new Uint8Array(fileBuf);
    }
  }

  const buffer = zipSync(zipMap, { level: 6 });
  const filename = `neko-zeni-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  return { buffer, filename };
}

export function isZipMagic(buffer: Uint8Array): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function parseBackupZip(
  buffer: Uint8Array,
): { ok: true; ledgerText: string; mediaFiles: Record<string, Uint8Array> } | { ok: false; error: string } {
  try {
    const files = unzipSync(buffer);
    const ledgerRaw = files["ledger.json"];
    if (!ledgerRaw?.length) {
      return { ok: false, error: "ZIP backup is missing ledger.json." };
    }
    return {
      ok: true,
      ledgerText: new TextDecoder("utf-8").decode(ledgerRaw),
      mediaFiles: files,
    };
  } catch {
    return { ok: false, error: "Could not read ZIP backup." };
  }
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
  const txIds = new Set(data.transactions.map((t) => t.id));
  for (const m of data.storedMedia ?? []) {
    if (m.transactionId && !txIds.has(m.transactionId)) {
      return `Stored media ${m.id} references unknown transaction ${m.transactionId}.`;
    }
  }
  return null;
}

export async function restoreLedgerBackupForUser(
  db: PrismaClient,
  args: {
    targetUserId: string;
    backup: LedgerBackup;
    expectedEmail: string;
    /** When restoring a full ZIP, clears existing uploads and re-imports `storedMedia` + files. */
    replaceStoredMedia?: boolean;
    mediaZipFiles?: Record<string, Uint8Array>;
  },
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
  const replaceMedia = Boolean(args.replaceStoredMedia && args.mediaZipFiles);

  if (replaceMedia) {
    const { removeUserMediaDirectory } = await import("@/lib/media/user-media-storage");
    await removeUserMediaDirectory(uid);
  }

  await db.$transaction(async (tx) => {
    if (replaceMedia) {
      await tx.storedMedia.deleteMany({ where: { userId: uid } });
    }
    await tx.financialPlan.deleteMany({ where: { userId: uid } });
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
          customCadence: r.customCadence ?? null,
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

    for (const part of chunk(b.financialPlans ?? [], 100)) {
      await tx.financialPlan.createMany({
        data: part.map((p) => ({
          id: p.id,
          userId: uid,
          kind: p.kind,
          title: p.title,
          description: p.description,
          amountCents: p.amountCents,
          currency: p.currency.toUpperCase().slice(0, 3),
          period: p.period,
          targetDate: p.targetDate ? new Date(p.targetDate) : null,
          sortOrder: p.sortOrder,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })),
      });
    }

    const userData: {
      preferredCurrency: string;
      onboardingCompleted: boolean;
      name?: string | null;
      nickname?: string | null;
    } = {
      preferredCurrency: b.preferredCurrency.toUpperCase().slice(0, 3),
      onboardingCompleted: b.onboardingCompleted,
    };
    if ("profileName" in b) userData.name = b.profileName ?? null;
    if ("profileNickname" in b) userData.nickname = b.profileNickname ?? null;

    await tx.user.update({
      where: { id: uid },
      data: userData,
    });
  });

  if (replaceMedia && b.storedMedia?.length && args.mediaZipFiles) {
    const { writeUserMediaFile } = await import("@/lib/media/user-media-storage");
    for (const row of b.storedMedia) {
      const bytes = args.mediaZipFiles[row.zipEntryPath];
      if (!bytes?.length) continue;
      const relativePath = await writeUserMediaFile(uid, row.id, row.mimeType, Buffer.from(bytes));
      await db.storedMedia.create({
        data: {
          id: row.id,
          userId: uid,
          mimeType: row.mimeType,
          originalFilename: row.originalFilename,
          byteSize: bytes.byteLength,
          sha256: row.sha256,
          relativePath,
          source: row.source || "chat",
          chatTurnId: row.chatTurnId,
          documentKind: row.documentKind,
          transactionId: row.transactionId,
          trainingOptIn: row.trainingOptIn,
          structuredExcerpt: row.structuredExcerpt,
          pendingImportJson: row.pendingImportJson ?? null,
          trainingExampleJson: row.trainingExampleJson ?? null,
          markedForTraining: row.markedForTraining ?? false,
          createdAt: new Date(row.createdAt),
        },
      });
    }
  }

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
