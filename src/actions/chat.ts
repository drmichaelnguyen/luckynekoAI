"use server";

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { z } from "zod";

import {
  acknowledgeShareImport,
  getShareImport,
  type ShareImportPayload,
} from "@/lib/share-import-cache";

const GeminiResponseSchema = z
  .object({
    documentKind: z.enum([
      "freeform_transaction",
      "receipt",
      "canadian_paystub",
      "unknown_document",
    ]),
    transaction: z.record(z.string(), z.unknown()).nullable().optional(),
    receipt: z.record(z.string(), z.unknown()).nullable().optional(),
    paystub: z.record(z.string(), z.unknown()).nullable().optional(),
    assistantMessage: z.string(),
    followUpQuestion: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export type ShareImportActionResult =
  | { ok: true; payload: Omit<ShareImportPayload, "expires"> }
  | { ok: false; error: string };

export async function getShareImportAction(
  id: string,
): Promise<ShareImportActionResult> {
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Missing import id." };

  const payload = getShareImport(trimmed);
  if (!payload) {
    return {
      ok: false,
      error: "That import link expired or was already used. Try sharing again.",
    };
  }

  const { expires: _expires, ...rest } = payload;
  return { ok: true, payload: rest };
}

export async function acknowledgeShareImportAction(id: string): Promise<void> {
  acknowledgeShareImport(id.trim());
}

const SYSTEM_INSTRUCTION = `You are Wallet Buddy AI, a Canadian-friendly finance assistant.
You MUST respond with JSON only (no markdown fences).

Your JSON MUST match this shape:
{
  "documentKind": "freeform_transaction" | "receipt" | "canadian_paystub" | "unknown_document",
  "transaction": null | object,
  "receipt": null | object,
  "paystub": null | object,
  "assistantMessage": string,
  "followUpQuestion": string | null
}

Rules:
- Choose exactly one primary extraction target: populate ONLY ONE of transaction/receipt/paystub with an object; set the others to null.
- If the user only typed text describing a purchase, use documentKind "freeform_transaction" and populate transaction.
- If the uploaded file is a receipt, use documentKind "receipt" and populate receipt with structured expense data suitable for database insertion.
- If the uploaded file is a Canadian paystub, use documentKind "canadian_paystub" and populate paystub with payroll fields suitable for database insertion.
- If you cannot confidently classify the file, use documentKind "unknown_document", set all extraction objects to null, explain briefly in assistantMessage, and ask what it is in followUpQuestion.

Transaction object fields (use null for unknown):
- amount: number | null
- currency: string | null (default CAD when implied)
- merchant: string | null
- category: string | null
- transactionDate: string | null (ISO yyyy-mm-dd if possible)
- notes: string | null

Receipt object fields (use null for unknown):
- total: number | null
- currency: string | null
- merchant: string | null
- purchaseDate: string | null (ISO yyyy-mm-dd if possible)
- subtotal: number | null
- taxTotal: number | null
- paymentMethod: string | null
- lineItems: array of { description: string | null, quantity: number | null, unitPrice: number | null, lineTotal: number | null }

Canadian paystub object fields (use null for unknown; amounts are numeric):
- employerName: string | null
- payPeriodStart: string | null (ISO date)
- payPeriodEnd: string | null (ISO date)
- grossPay: number | null
- netPay: number | null
- incomeTax: number | null
- cpp: number | null
- ei: number | null
- currency: string | null (default CAD)
- otherDeductions: array of { name: string, amount: number | null }

Follow-ups:
- If important fields are missing or ambiguous (example: category), set followUpQuestion to ONE short, friendly question.
- If you have everything you need, set followUpQuestion to null.

assistantMessage should be a concise, human summary of what you understood (1-3 sentences), not raw JSON.`;

function buildUserPrompt(input: {
  message: string;
  shareContext?: { title?: string; text?: string; url?: string };
}): string {
  const lines: string[] = [];
  lines.push("User message:");
  lines.push(input.message || "(empty)");

  if (input.shareContext && (input.shareContext.title || input.shareContext.text || input.shareContext.url)) {
    lines.push("");
    lines.push("Optional share metadata from the OS share sheet:");
    if (input.shareContext.title) lines.push(`title: ${input.shareContext.title}`);
    if (input.shareContext.text) lines.push(`text: ${input.shareContext.text}`);
    if (input.shareContext.url) lines.push(`url: ${input.shareContext.url}`);
  }

  lines.push("");
  lines.push("Return ONLY valid JSON matching the schema described in your system instructions.");
  return lines.join("\n");
}

export async function handleChatInput(formData: FormData) {
  const message = String(formData.get("message") ?? "").trim();
  const shareContextRaw = String(formData.get("shareContext") ?? "").trim();

  let shareContext: { title?: string; text?: string; url?: string } | undefined;
  if (shareContextRaw) {
    try {
      const parsed = JSON.parse(shareContextRaw) as unknown;
      if (parsed && typeof parsed === "object") {
        shareContext = parsed as { title?: string; text?: string; url?: string };
      }
    } catch {
      shareContext = undefined;
    }
  }

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!message && files.length === 0) {
    return {
      ok: false as const,
      error: "Add a message or attach a file.",
    };
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return {
      ok: false as const,
      error:
        "Server is missing GOOGLE_GENERATIVE_AI_API_KEY. Copy .env.example to .env.local and add your key.",
    };
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0.15,
      responseMimeType: "application/json",
    },
  });

  const prompt = buildUserPrompt({ message, shareContext });
  const parts: Part[] = [{ text: prompt }];

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());
    parts.push({
      inlineData: {
        mimeType,
        data: buffer.toString("base64"),
      },
    });
  }

  try {
    const result = await model.generateContent(parts);
    const rawText = result.response.text();
    const json = JSON.parse(rawText) as unknown;
    const parsed = GeminiResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false as const,
        error: "The model returned an unexpected format. Try again.",
      };
    }

    const data = parsed.data;
    const structured = {
      documentKind: data.documentKind,
      transaction: data.transaction ?? null,
      receipt: data.receipt ?? null,
      paystub: data.paystub ?? null,
    };

    return {
      ok: true as const,
      assistantMessage: data.assistantMessage,
      structured,
      followUpQuestion: data.followUpQuestion ?? null,
    };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error calling Gemini.";
    return {
      ok: false as const,
      error: messageText,
    };
  }
}
