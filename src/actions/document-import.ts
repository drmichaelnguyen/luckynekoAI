"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { auth } from "@/auth";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { chooseStructuredTextPrimary, orderedProviders, parseModelJson } from "@/lib/ai/model-router";
import { findOrCreateCategory } from "@/lib/finance/category-resolver";
import { persistTransactionListLedgerEntries } from "@/lib/finance/persist-from-chat";
import { persistPaystubLedgerEntry, persistReceiptLedgerEntry } from "@/lib/finance/persist-receipt-paystub";
import type { PendingImportPayloadV1, PendingImportPayloadV2 } from "@/lib/document-import/pending-import-shared";
import { loadSpendingPatterns, applyMerchantCategoryRule } from "@/lib/learning/spending-patterns";
import { prisma } from "@/lib/prisma";

const PendingPayloadSchema = z.union([
  z.object({
    version: z.literal(1),
    chatTurnId: z.string(),
    documentKind: z.enum(["receipt", "canadian_paystub", "payroll_document"]),
    extractedTextSummary: z.string(),
    proposed: z.record(z.string(), z.unknown()),
  }),
  z.object({
    version: z.literal(2),
    chatTurnId: z.string(),
    documentKind: z.enum(["receipt", "canadian_paystub", "payroll_document", "transaction_list_capture"]),
    extractedTextSummary: z.string(),
    proposed: z.record(z.string(), z.unknown()).nullable(),
    proposedItems: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
]);

const MergeSchema = z.object({
  receipt: z.record(z.string(), z.unknown()).nullable().optional(),
  paystub: z.record(z.string(), z.unknown()).nullable().optional(),
});

async function mergeProposedWithUserCorrections(input: {
  documentKind: "receipt" | "canadian_paystub" | "payroll_document";
  proposed: Record<string, unknown>;
  extractedTextSummary: string;
  correctionText: string;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey && !has9RouterConfig()) {
    return input.proposed;
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const systemInstruction = `You apply a user's correction instructions to structured financial extraction JSON.
Return JSON only (no markdown) with exactly one of these keys populated to match the document kind:
{ "receipt": object } OR { "paystub": object }
Use the same field names and types as the input object. Preserve fields the user did not dispute. Do not invent merchants or totals the user did not supply.`;
  const model = apiKey
    ? new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      })
    : null;

  const prompt = `Document kind: ${input.documentKind}

Extracted text summary (from document OCR-style pass):
${input.extractedTextSummary}

Current structured extraction (apply corrections on top of this):
${JSON.stringify(input.proposed)}

User correction instructions (natural language):
${input.correctionText}

Return only valid JSON with a single top-level key "receipt" or "paystub" matching document kind.`;

  try {
    let parsed: z.SafeParseReturnType<unknown, z.infer<typeof MergeSchema>> | null = null;
    const providerOrder = orderedProviders({
      preferred: chooseStructuredTextPrimary({ nineRouterAvailable: has9RouterConfig() }),
      geminiAvailable: Boolean(model),
      nineRouterAvailable: has9RouterConfig(),
    });

    for (const provider of providerOrder) {
      try {
        const raw =
          provider === "gemini"
            ? (await model!.generateContent(prompt)).response.text()
            : await call9RouterChatCompletion({
                systemInstruction,
                userPrompt: prompt,
                temperature: 0.1,
              });
        parsed = MergeSchema.safeParse(parseModelJson(raw));
        if (parsed.success) break;
      } catch {
        parsed = null;
      }
    }
    if (!parsed?.success) return input.proposed;
    if (input.documentKind === "receipt" && parsed.data.receipt && typeof parsed.data.receipt === "object") {
      return parsed.data.receipt;
    }
    if (
      (input.documentKind === "canadian_paystub" || input.documentKind === "payroll_document") &&
      parsed.data.paystub &&
      typeof parsed.data.paystub === "object"
    ) {
      return parsed.data.paystub;
    }
  } catch {
    /* fall through */
  }
  return input.proposed;
}

export type ResolveDocumentImportResult =
  | { ok: true; message: string; transactionId?: string }
  | { ok: false; error: string };

/**
 * After the model staged a receipt/paystub import, the user confirms ADD (save as read) or EDIT (natural-language corrections, then save).
 * EDIT marks the upload for optional training export (image + extraction + correction bundle on StoredMedia).
 */
export async function resolveDocumentImportAction(formData: FormData): Promise<ResolveDocumentImportResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sign in to continue." };
  }

  const chatTurnId = String(formData.get("chatTurnId") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim().toLowerCase();
  const correctionText = String(formData.get("correctionText") ?? "").trim();

  if (!chatTurnId) {
    return { ok: false, error: "Missing import reference." };
  }
  if (mode !== "add" && mode !== "edit") {
    return { ok: false, error: "Choose add or edit." };
  }
  if (mode === "edit" && !correctionText) {
    return { ok: false, error: "Describe what to change, then try again." };
  }

  const rows = await prisma.storedMedia.findMany({
    where: {
      userId: session.user.id,
      chatTurnId,
      pendingImportJson: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length === 0) {
    return { ok: false, error: "Nothing is waiting for import, or it already expired. Send the document again." };
  }

  const first = rows[0];
  if (!first.pendingImportJson) {
    return { ok: false, error: "Missing pending import data." };
  }

  let pending: PendingImportPayloadV1 | PendingImportPayloadV2;
  try {
    const raw = JSON.parse(first.pendingImportJson) as unknown;
    const parsed = PendingPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: "Stored import data is invalid." };
    }
    pending = parsed.data;
  } catch {
    return { ok: false, error: "Could not read pending import data." };
  }

  const initialProposed = pending.proposed;
  if (!initialProposed || typeof initialProposed !== "object" || Array.isArray(initialProposed)) {
    return { ok: false, error: "Missing proposed import data." };
  }

  let finalStructured: Record<string, unknown> = initialProposed;
  let trainingExampleJson: string | null = null;
  let markedForTraining = false;

  if (pending.documentKind === "transaction_list_capture") {
    return { ok: false, error: "Use Log all for transaction-list screenshots." };
  }

  if (mode === "edit") {
    finalStructured = await mergeProposedWithUserCorrections({
      documentKind: pending.documentKind,
      proposed: initialProposed,
      extractedTextSummary: pending.extractedTextSummary,
      correctionText,
    });
    markedForTraining = true;
    try {
      trainingExampleJson = JSON.stringify({
        version: 1,
        documentKind: pending.documentKind,
        extractedTextSummary: pending.extractedTextSummary,
        originalProposed: initialProposed,
        userCorrectionInstructions: correctionText,
        mergedFinal: finalStructured,
        mediaIds: rows.map((r) => r.id),
        createdAt: new Date().toISOString(),
      }).slice(0, 500_000);
    } catch {
      trainingExampleJson = null;
    }
  }

  // Apply learned merchant-category rules before persisting
  try {
    const patterns = await loadSpendingPatterns(prisma, session.user.id);
    finalStructured = applyMerchantCategoryRule(finalStructured, patterns.merchantHints);
  } catch {
    // learning rules are best-effort; continue if they fail
  }

  const rawStructuredJson = JSON.stringify({
    documentKind: pending.documentKind,
    ...(pending.documentKind === "receipt" ? { receipt: finalStructured } : { paystub: finalStructured }),
  });

  let persist: { saved: boolean; detail: string; transactionId?: string };
  if (pending.documentKind === "receipt") {
    persist = await persistReceiptLedgerEntry(prisma, session.user.id, finalStructured, rawStructuredJson);
  } else {
    persist = await persistPaystubLedgerEntry(prisma, session.user.id, finalStructured, rawStructuredJson);
  }

  if (!persist.saved) {
    return { ok: false, error: persist.detail || "Could not save to the ledger." };
  }

  await prisma.storedMedia.updateMany({
    where: { userId: session.user.id, chatTurnId },
    data: {
      pendingImportJson: null,
      transactionId: persist.transactionId,
      trainingExampleJson,
      markedForTraining,
      structuredExcerpt: JSON.stringify({
        documentKind: pending.documentKind,
        transactionId: persist.transactionId,
        importResolved: true,
      }).slice(0, 4000),
    },
  });

  const msg =
    mode === "edit"
      ? `${persist.detail}${markedForTraining ? " Your corrections were saved for optional future training export (see backup ZIP / training manifest)." : ""}`
      : persist.detail;

  return { ok: true, message: msg, transactionId: persist.transactionId };
}

export async function persistReceiptSplitAction(
  chatTurnId: string,
  items: { description: string; category: string; amount: number; currency: string; direction: "in" | "out" }[],
): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Unauthorized" };

  const wallets = await prisma.wallet.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  const wallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  if (!wallet) return { ok: false, message: "No wallet configured." };

  const saved: string[] = [];
  for (const item of items) {
    if (!item.amount || item.amount <= 0) continue;
    const cat = await findOrCreateCategory({
      db: prisma,
      userId: session.user.id,
      label: item.category,
      direction: item.direction,
      fallbackSlug: item.direction === "in" ? "income" : "other",
    });
    await prisma.transaction.create({
      data: {
        userId: session.user.id,
        walletId: wallet.id,
        categoryId: cat?.id ?? null,
        amountCents: Math.round(Math.abs(item.amount) * 100),
        direction: item.direction,
        currency: item.currency.toUpperCase(),
        merchant: null,
        memo: item.description.slice(0, 2000),
        occurredAt: new Date(),
        recurrence: "one_time",
        status: "posted",
        source: "chat_receipt_split",
      },
    });
    saved.push(`${item.category}: ${item.currency} ${item.amount.toFixed(2)}`);
  }

  // Clear the pending flag on linked media
  await prisma.storedMedia.updateMany({
    where: { userId: session.user.id, chatTurnId },
    data: { pendingImportJson: null },
  });

  return { ok: true, message: `Saved ${saved.length} split entr${saved.length === 1 ? "y" : "ies"}: ${saved.join(", ")}.` };
}

export async function persistTransactionListAction(
  chatTurnId: string,
  selectedIndexes?: number[],
): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Unauthorized" };

  const rows = await prisma.storedMedia.findMany({
    where: {
      userId: session.user.id,
      chatTurnId,
      pendingImportJson: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length === 0) {
    return { ok: false, message: "Nothing is waiting for import, or it already expired. Send the screenshot again." };
  }

  const first = rows[0];
  if (!first.pendingImportJson) {
    return { ok: false, message: "Missing pending import data." };
  }

  let pending: PendingImportPayloadV1 | PendingImportPayloadV2;
  try {
    const raw = JSON.parse(first.pendingImportJson) as unknown;
    const parsed = PendingPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Stored import data is invalid." };
    }
    pending = parsed.data;
  } catch {
    return { ok: false, message: "Could not read pending import data." };
  }

  if (pending.documentKind !== "transaction_list_capture") {
    return { ok: false, message: "This import is not a transaction list screenshot." };
  }

  const allItems = Array.isArray(pending.proposedItems) ? pending.proposedItems : [];
  const proposedItems =
    Array.isArray(selectedIndexes) && selectedIndexes.length > 0
      ? allItems.filter((_, index) => selectedIndexes.includes(index))
      : allItems;
  if (proposedItems.length === 0) {
    return { ok: false, message: "Choose at least one scanned transaction to add." };
  }
  const persist = await persistTransactionListLedgerEntries(prisma, session.user.id, proposedItems);
  if (!persist.saved) {
    return { ok: false, message: persist.detail };
  }

  await prisma.storedMedia.updateMany({
    where: { userId: session.user.id, chatTurnId },
    data: {
      pendingImportJson: null,
      transactionId: persist.transactionIds[0] ?? null,
      structuredExcerpt: JSON.stringify({
        documentKind: pending.documentKind,
        transactionCount: persist.transactionIds.length,
        importResolved: true,
      }).slice(0, 4000),
    },
  });

  return { ok: true, message: persist.detail };
}
