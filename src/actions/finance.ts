"use server";

import crypto from "crypto";
import { auth } from "@/auth";
import { call9RouterChatCompletion } from "@/lib/ai/9router";
import { callIconImageGeneration, loadGeneratedImageBuffer, normalizeIconImageBuffer } from "@/lib/ai/image-generation";
import { writeUserMediaFile } from "@/lib/media/user-media-storage";
import {
  defaultNextReminderAt,
  parseCadenceInput,
  type RecurrentCadence,
} from "@/lib/finance/cadence";
import { ensureFinanceSeed } from "@/lib/finance/seed";
import { applyLedgerEdit, type LedgerEditRequest } from "@/lib/finance/persist-from-chat";
import { prisma } from "@/lib/prisma";

export type ConfirmRecurringMode = {
  kind: "recurring";
  cadence: RecurrentCadence;
  customCadence?: string | null;
  nextReminderAt?: string | null;
};
export type ConfirmTransactionMode =
  | { kind: "one_time" }
  | ConfirmRecurringMode
  // Back-compat with the original string form used by older UI callers.
  | "one_time"
  | "start_recurring_monthly";

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
      categoryIcon: t.category?.icon ?? null,
    })),
  };
}

export async function confirmTransactionAction(
  id: string,
  mode: ConfirmTransactionMode,
) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };

  const tx = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id, status: "pending_user" },
    include: { wallet: true, category: true },
  });
  if (!tx) return { ok: false as const, error: "Nothing to confirm." };

  const normalized =
    typeof mode === "string"
      ? mode === "one_time"
        ? { kind: "one_time" as const }
        : { kind: "recurring" as const, cadence: "monthly" as RecurrentCadence }
      : mode;

  if (normalized.kind === "one_time") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { recurrence: "one_time", status: "posted", confirmReason: null },
    });
    return { ok: true as const };
  }

  const cadence = normalized.cadence;
  const customCadence = (normalized.customCadence ?? null)?.trim() || null;
  const parsedReminder = normalized.nextReminderAt
    ? new Date(normalized.nextReminderAt)
    : null;
  const nextReminderAt =
    parsedReminder && !Number.isNaN(parsedReminder.getTime())
      ? parsedReminder
      : defaultNextReminderAt(tx.occurredAt, cadence);

  const series = await prisma.recurrentSeries.create({
    data: {
      userId: session.user.id,
      walletId: tx.walletId,
      categoryId: tx.categoryId,
      label: tx.merchant ?? tx.memo ?? "Recurring",
      cadence,
      customCadence,
      amountCents: tx.amountCents,
      direction: tx.direction,
      nextReminderAt,
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

  return { ok: true as const, seriesId: series.id };
}

export type RecurrentSeriesRow = {
  id: string;
  label: string;
  walletId: string;
  walletName: string;
  categoryId: string | null;
  categoryName: string;
  cadence: RecurrentCadence;
  customCadence: string | null;
  amountCents: number;
  direction: "in" | "out";
  currency: string;
  nextReminderAt: string | null;
  isPaused: boolean;
  notes: string | null;
};

export async function listRecurrentSeriesAction(): Promise<
  { ok: true; rows: RecurrentSeriesRow[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const rows = await prisma.recurrentSeries.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isPaused: "asc" }, { nextReminderAt: "asc" }, { createdAt: "desc" }],
    include: {
      wallet: { select: { name: true } },
      category: { select: { name: true } },
      transactions: { select: { currency: true }, take: 1, orderBy: { occurredAt: "desc" } },
    },
  });
  return {
    ok: true,
    rows: rows.map((s) => ({
      id: s.id,
      label: s.label,
      walletId: s.walletId,
      walletName: s.wallet.name,
      categoryId: s.categoryId,
      categoryName: s.category?.name ?? "Other",
      cadence: s.cadence as RecurrentCadence,
      customCadence: s.customCadence,
      amountCents: s.amountCents,
      direction: s.direction as "in" | "out",
      currency: s.transactions[0]?.currency ?? "CAD",
      nextReminderAt: s.nextReminderAt?.toISOString() ?? null,
      isPaused: s.isPaused,
      notes: s.notes,
    })),
  };
}

export type UpdateRecurrentSeriesFields = {
  label?: string;
  cadence?: RecurrentCadence;
  customCadence?: string | null;
  nextReminderAt?: string | null;
  isPaused?: boolean;
};

export async function updateRecurrentSeriesAction(
  id: string,
  fields: UpdateRecurrentSeriesFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const existing = await prisma.recurrentSeries.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) return { ok: false, error: "Not found." };

  const data: Record<string, unknown> = {};
  if (typeof fields.label === "string" && fields.label.trim()) {
    data.label = fields.label.trim().slice(0, 200);
  }
  if (fields.cadence) data.cadence = fields.cadence;
  if (fields.customCadence !== undefined) {
    const v = fields.customCadence?.trim() ?? "";
    data.customCadence = v ? v.slice(0, 200) : null;
  }
  if (fields.nextReminderAt !== undefined) {
    if (!fields.nextReminderAt) data.nextReminderAt = null;
    else {
      const d = new Date(fields.nextReminderAt);
      if (!Number.isNaN(d.getTime())) data.nextReminderAt = d;
    }
  }
  if (typeof fields.isPaused === "boolean") data.isPaused = fields.isPaused;

  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.recurrentSeries.update({ where: { id }, data });
  return { ok: true };
}

export async function deleteRecurrentSeriesAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const r = await prisma.recurrentSeries.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (r.count === 0) return { ok: false, error: "Not found." };
  return { ok: true };
}

/**
 * Natural-language helper for the chat bot — parses a freeform description and
 * applies it to a pending transaction as either a one-time or recurring confirmation.
 * Called by chat.ts when the LLM returns a pendingRecurrenceUpdate.
 */
export async function applyPendingRecurrenceFromTextAction(args: {
  pendingTransactionId: string;
  text: string;
  nextReminderAt?: string | null;
}): Promise<{ ok: true; seriesId?: string } | { ok: false; error: string }> {
  const { pendingTransactionId, text } = args;
  const lower = (text ?? "").trim().toLowerCase();
  if (!lower) return { ok: false, error: "No cadence text." };

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  if (/^(one[\s-]?time|one off|not recurring|no repeat|doesn'?t repeat)$/.test(lower)) {
    const r = await confirmTransactionAction(pendingTransactionId, { kind: "one_time" });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  const { cadence, customCadence } = parseCadenceInput(text);
  const r = await confirmTransactionAction(pendingTransactionId, {
    kind: "recurring",
    cadence,
    customCadence,
    nextReminderAt: args.nextReminderAt ?? null,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, seriesId: r.seriesId };
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

export async function updateCategoryIconAction(categoryId: string, iconPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  await prisma.category.updateMany({
    where: { id: categoryId, userId: session.user.id },
    data: { icon: iconPath },
  });
  return { ok: true };
}

export async function generateCategoryIconAction(categoryId: string, prompt: string): Promise<{ ok: true; icon: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId: session.user.id },
    include: { parent: true },
  });
  if (!category) return { ok: false, error: "Category not found." };

  try {
    const categoryPath = category.parent ? `${category.parent.name} > ${category.name}` : category.name;
    const userPrompt = prompt.trim() || categoryPath;
    const promptRewrite = [
      "You write concise image-generation prompts for finance app icons.",
      "Rewrite the input as a single prompt for a square icon image used in a money management app.",
      "The app is a money management / finance app called NekoZeni.",
      "Use the category context and user request together to decide the symbol.",
      "Prioritize a single, obvious object or symbol that reads well at 24px to 64px.",
      "The image should feel polished, modern, friendly, and instantly readable at small sizes.",
      "No text, no watermark, no screenshot, no UI mockup, no collage, and no clutter.",
      "Keep it focused on one centered subject with generous padding and a transparent background when possible.",
      "Return only the rewritten prompt text.",
    ].join(" ");
    const promptSource = [
      `Category context: ${categoryPath}`,
      `User prompt: ${userPrompt}`,
      "Injected app context: NekoZeni is a money management app, so the icon must work as a compact category chip in a financial dashboard.",
      "Design direction: flat, bold, centered, minimal, friendly, and optimized for a wallet/spending tracker interface.",
    ].join("\n");

    let fullPrompt = [
      `Create a custom mobile app category icon for "${categoryPath}" in NekoZeni, a money management app.`,
      `The icon should depict: ${userPrompt}.`,
      "Interpret the category context and the user's prompt together; do not ignore either one.",
      "Use a clean, bold, easy-to-recognize flat design with a centered composition and strong silhouette.",
      "Keep it square, with no text, and use a transparent background or a very simple solid background.",
      "Make it suitable for a finance app category chip and readable at thumbnail size.",
    ].join(" ");

    try {
      const promptResult = await call9RouterChatCompletion({
        systemInstruction: promptRewrite,
        userPrompt: promptSource,
        temperature: 0.2,
      });
      const rewritten = promptResult.text.trim().replace(/^["'`]+|["'`]+$/g, "");
      if (rewritten) {
        fullPrompt = rewritten;
      }
    } catch {
      // Fall back to the local prompt when prompt rewriting is unavailable.
    }

    const result = await callIconImageGeneration({
      prompt: fullPrompt,
      nineRouterModel: "image-creation",
    });
    const raw = await loadGeneratedImageBuffer(result.imageUrl);
    const normalized = await normalizeIconImageBuffer(raw);

    const id = crypto.randomUUID();
    const relativePath = await writeUserMediaFile(session.user.id, id, normalized.mimeType, normalized.buffer);
    const apiPath = `/api/media/${relativePath}`;

    await prisma.category.update({
      where: { id: categoryId },
      data: { icon: apiPath },
    });

    return { ok: true, icon: apiPath };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to generate icon." };
  }
}

export async function confirmLedgerEditAction(
  edit: LedgerEditRequest,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const result = await applyLedgerEdit(prisma, session.user.id, edit);
  if (!result.saved) return { ok: false, error: result.detail || "Unable to apply the edit." };
  return { ok: true, message: result.detail || "Bulk edit applied." };
}

export async function listCategoriesAction(): Promise<{ ok: true; categories: CategoryOption[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
  const categories = await prisma.category.findMany({
    where: { userId: session.user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, parentId: true, icon: true, parent: { select: { name: true } } },
  });
  return {
    ok: true,
    categories: categories.map(c => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      parentName: c.parent?.name ?? null,
      icon: c.icon,
    }))
  };
}
