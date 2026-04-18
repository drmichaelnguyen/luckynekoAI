"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { auth } from "@/auth";
import { persistPaystubLedgerEntry, persistReceiptLedgerEntry } from "@/lib/finance/persist-receipt-paystub";
import { prisma } from "@/lib/prisma";

export const PENDING_IMPORT_VERSION = 1 as const;

export type PendingImportPayloadV1 = {
  version: typeof PENDING_IMPORT_VERSION;
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub";
  extractedTextSummary: string;
  proposed: Record<string, unknown>;
};

const PendingPayloadSchema = z.object({
  version: z.literal(1),
  chatTurnId: z.string(),
  documentKind: z.enum(["receipt", "canadian_paystub"]),
  extractedTextSummary: z.string(),
  proposed: z.record(z.string(), z.unknown()),
});

const MergeSchema = z.object({
  receipt: z.record(z.string(), z.unknown()).nullable().optional(),
  paystub: z.record(z.string(), z.unknown()).nullable().optional(),
});

async function mergeProposedWithUserCorrections(input: {
  documentKind: "receipt" | "canadian_paystub";
  proposed: Record<string, unknown>;
  extractedTextSummary: string;
  correctionText: string;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return input.proposed;
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: `You apply a user's correction instructions to structured financial extraction JSON.
Return JSON only (no markdown) with exactly one of these keys populated to match the document kind:
{ "receipt": object } OR { "paystub": object }
Use the same field names and types as the input object. Preserve fields the user did not dispute. Do not invent merchants or totals the user did not supply.`,
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });

  const prompt = `Document kind: ${input.documentKind}

Extracted text summary (from document OCR-style pass):
${input.extractedTextSummary}

Current structured extraction (apply corrections on top of this):
${JSON.stringify(input.proposed)}

User correction instructions (natural language):
${input.correctionText}

Return only valid JSON with a single top-level key "receipt" or "paystub" matching document kind.`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const json = JSON.parse(raw) as unknown;
    const parsed = MergeSchema.safeParse(json);
    if (!parsed.success) return input.proposed;
    if (input.documentKind === "receipt" && parsed.data.receipt && typeof parsed.data.receipt === "object") {
      return parsed.data.receipt;
    }
    if (input.documentKind === "canadian_paystub" && parsed.data.paystub && typeof parsed.data.paystub === "object") {
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

  let pending: PendingImportPayloadV1;
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

  let finalStructured = pending.proposed;
  let trainingExampleJson: string | null = null;
  let markedForTraining = false;

  if (mode === "edit") {
    finalStructured = await mergeProposedWithUserCorrections({
      documentKind: pending.documentKind,
      proposed: pending.proposed,
      extractedTextSummary: pending.extractedTextSummary,
      correctionText,
    });
    markedForTraining = true;
    try {
      trainingExampleJson = JSON.stringify({
        version: 1,
        documentKind: pending.documentKind,
        extractedTextSummary: pending.extractedTextSummary,
        originalProposed: pending.proposed,
        userCorrectionInstructions: correctionText,
        mergedFinal: finalStructured,
        mediaIds: rows.map((r) => r.id),
        createdAt: new Date().toISOString(),
      }).slice(0, 500_000);
    } catch {
      trainingExampleJson = null;
    }
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
