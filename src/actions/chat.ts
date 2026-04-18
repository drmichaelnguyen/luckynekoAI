"use server";

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { PENDING_IMPORT_VERSION } from "@/lib/document-import/pending-import-shared";
import { auth } from "@/auth";
import { persistFreeformLedgerEntry } from "@/lib/finance/persist-from-chat";
import { financeContextLines } from "@/lib/finance/seed";
import { maybeCompressImageForStorage } from "@/lib/media/compress-image-for-storage";
import {
  assertAllowedChatMime,
  assertUploadSize,
  sanitizeOriginalFilename,
  sha256Hex,
  unlinkUserMediaRelative,
  writeUserMediaFile,
} from "@/lib/media/user-media-storage";
import type { ConversationTurnForApi } from "@/lib/chat/conversation-context";
import { prisma } from "@/lib/prisma";
import type { PendingDocumentImport } from "@/types/chat";
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
      "payroll_document",
      "unknown_document",
    ]),
    transaction: z.record(z.string(), z.unknown()).nullable().optional(),
    receipt: z.record(z.string(), z.unknown()).nullable().optional(),
    paystub: z.record(z.string(), z.unknown()).nullable().optional(),
    assistantMessage: z.string(),
    followUpQuestion: z.union([z.string(), z.null()]).optional(),
    /** Plain-language readout of what appears on the uploaded bill/receipt/paystub (required for financial uploads). */
    extractedTextSummary: z.union([z.string(), z.null()]).optional(),
    /** When true with a financial document upload, the app waits for explicit user ADD/EDIT before writing the ledger. */
    awaitingLedgerDecision: z.boolean().optional(),
    /** Per-category split items proposed for a mixed-category receipt. */
    receiptSplit: z
      .array(
        z.object({
          description: z.string(),
          category: z.string(),
          amount: z.number(),
          currency: z.string().optional(),
          direction: z.enum(["in", "out"]).optional(),
        }),
      )
      .nullable()
      .optional(),
    /** Populated when the user expresses intent to buy something (not yet purchased). Auto-saved as a financial plan. */
    planSuggestion: z
      .object({
        title: z.string(),
        description: z.string().nullable().optional(),
        amountCents: z.number().nullable().optional(),
        currency: z.string().optional(),
        period: z.enum(["none", "weekly", "monthly", "yearly"]).optional(),
        targetDate: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const PAYROLL_DOCUMENT_KINDS = ["canadian_paystub", "payroll_document"] as const;

function isPayrollDocumentKind(value: string): value is (typeof PAYROLL_DOCUMENT_KINDS)[number] {
  return PAYROLL_DOCUMENT_KINDS.includes(value as (typeof PAYROLL_DOCUMENT_KINDS)[number]);
}

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

const SYSTEM_INSTRUCTION = `You are NekoZeni, a friendly lucky-cat-themed finance assistant for people in Canada and Vietnam.
You MUST respond with JSON only (no markdown fences).

Your JSON MUST match this shape (optional keys only when relevant):
{
  "documentKind": "freeform_transaction" | "receipt" | "payroll_document" | "unknown_document",
  "transaction": null | object,
  "receipt": null | object,
  "paystub": null | object,
  "assistantMessage": string,
  "followUpQuestion": string | null,
  "extractedTextSummary": string | null,
  "awaitingLedgerDecision": boolean,
  "receiptSplit": null | [{ "description": string, "category": string, "amount": number, "currency": string, "direction": "in"|"out" }],
  "planSuggestion": null | { "title": string, "description": string | null, "amountCents": number | null, "currency": string, "period": "none" | "monthly" | "yearly" }
}

Rules:
- The user message may include USER PREFERENCES (how to address them in chat) and FINANCIAL PLANS (spending budgets and savings goals). Follow those when giving advice; do not ignore a stated monthly cap or savings target without asking first.
- Choose exactly one primary extraction target: populate ONLY ONE of transaction/receipt/paystub with an object; set the others to null.
- If the user only typed text describing a purchase, use documentKind "freeform_transaction" and populate transaction.
- If the uploaded file is a clear retail or service purchase receipt or bill (you can read totals and context), use documentKind "receipt" and populate receipt with structured expense data suitable for database insertion.
- If the uploaded file is a payroll or payslip document from Canada or Vietnam, use documentKind "payroll_document" and populate paystub with payroll fields suitable for database insertion.
- If you cannot confidently classify the file, use documentKind "unknown_document", set all extraction objects to null, explain briefly in assistantMessage, and ask what it is in followUpQuestion.

Uploaded files (images/PDF) — pipeline before anything hits the ledger:
1) Classify first: is this a financial document about money (retail/service receipt, bill, paid invoice, payroll document, bank or card slip with amounts)? If clearly NO, use documentKind "unknown_document", all extraction objects null, stop — do not pretend it is a receipt.
2) If YES: use documentKind "receipt" or "payroll_document" and populate only that object; use null for unreadable fields instead of guessing.
3) extractedTextSummary: when documentKind is receipt or payroll_document AND the user attached a file, you MUST set this to a plain-text, human-readable readout of the document (merchant lines, dates, line items, taxes, totals, payment method or payroll sections) — like reading the page aloud, not JSON.
4) awaitingLedgerDecision: set true when there is a file attachment and documentKind is receipt or payroll_document. The user must explicitly confirm in the app before a ledger row is created from that upload; do not state that the receipt is already saved in their ledger from the file alone.
5) Typed-only purchases (no file) use freeform_transaction; omit awaitingLedgerDecision or set false.
6) Amount normalization matters: return numeric amounts, not formatted strings. For VND, return whole-dong numbers like 1250000. For CAD, return decimal numbers like 47.82.
7) Dates should be normalized to ISO yyyy-mm-dd whenever the document makes the date reasonably clear.
8) Currency conversion: the USER LEDGER CONTEXT includes live EXCHANGE RATES and a "Preferred currency" field.
9) Category splitting: if a receipt or bill clearly contains line items across DIFFERENT categories (e.g. groceries + electronics + clothing in one Costco trip, or a utility bill mixing internet + phone), populate receiptSplit with one entry per category group — each with description, category (matching the user's CATEGORIES list), amount, currency, and direction. The individual amounts must sum to the total. Set awaitingLedgerDecision true so the user can review and confirm each split. If everything belongs to a single category, leave receiptSplit null and use the normal receipt object. If the user states an amount in a foreign currency (different from their preferred currency), convert it to their preferred currency using those rates and set the transaction/receipt currency to the preferred currency. Always mention both the original amount and the converted amount in assistantMessage (e.g. "50 USD ≈ 68.20 CAD"). If no exchange rate context is available, record the amount in the original currency and note the conversion is needed.

Transaction object fields (use null for unknown):
- amount: number | null (major currency units, positive for magnitude; use direction for sign semantics)
- currency: string | null (default CAD when implied)
- merchant: string | null
- category: string | null (must align with a CATEGORY name from the USER LEDGER CONTEXT appended to the user message)
- transactionDate: string | null (ISO yyyy-mm-dd if possible)
- notes: string | null
- walletLabel: string | null (must match a WALLET name from USER LEDGER CONTEXT; if unsure use "Main")
- direction: "in" | "out" | null — "in" for income, refunds to the user, transfers in; "out" for spending
- recurrence: "one_time" | "recurrent" | "unknown"
- needsUserConfirm: boolean — true if this might be a repeating bill, loan, subscription, or utility charge
- userConfirmReason: string | null — short reason when needsUserConfirm is true
- payeeKind: "purchase" | "bill" | "loan" | "subscription" | "utility" | "income" | "transfer" | null

Bookkeeping rules for freeform_transaction:
- When the user describes everyday shopping, use recurrence "one_time" and needsUserConfirm false unless unclear.
- For rent, mortgage, car loan, BNPL, phone plan, streaming, insurance, or utilities, prefer recurrence "recurrent" or "unknown" with needsUserConfirm true and a friendly userConfirmReason.
- Always pick the closest category from the provided list; if none fit, use "Other".

Receipt object fields (use null for unknown):
- total: number | null
- currency: string | null
- merchant: string | null
- purchaseDate: string | null (ISO yyyy-mm-dd if possible)
- subtotal: number | null
- taxTotal: number | null
- paymentMethod: string | null
- lineItems: array of { description: string | null, quantity: number | null, unitPrice: number | null, lineTotal: number | null }

Receipt / bill uploads — when to ask the user again (not optional):
- If the image or PDF is clearly NOT a purchase receipt or bill (e.g. unrelated photo, meme, blank page, map, screenshot with no payment, letter, packaging without a payment total you trust), use documentKind "unknown_document", set receipt to null, keep assistantMessage short and honest, and followUpQuestion MUST be one friendly question asking them to upload a legible receipt or briefly type what they spent and where.
- If it might be a receipt but you are unsure (wrong document, unreadable blur, glare, crop cuts off totals, could be an invoice/quote/return slip instead of a paid receipt, or you would be guessing merchant or total), do NOT invent amounts or a fake merchant: prefer documentKind "unknown_document" with extraction nulls and followUpQuestion asking what this is or to retake the photo — OR use documentKind "receipt" only with null for any field you cannot read, and followUpQuestion MUST ask for the doubtful or missing piece (e.g. exact total, store name, or date).
- If total OR merchant would require guessing, leave them null and set followUpQuestion (do not fill plausible guesses).
- When you use "unknown_document" because the file is not a bill or is confusing, followUpQuestion must never be null.

Payroll document object fields (use null for unknown; amounts are numeric):
- employerName: string | null
- employeeName: string | null
- payDate: string | null (ISO date)
- payPeriodStart: string | null (ISO date)
- payPeriodEnd: string | null (ISO date)
- grossPay: number | null
- netPay: number | null
- incomeTax: number | null
- cpp: number | null
- ei: number | null
- socialInsurance: number | null
- healthInsurance: number | null
- unemploymentInsurance: number | null
- pension: number | null
- currency: string | null (default CAD for Canadian docs, VND for Vietnamese docs)
- otherDeductions: array of { name: string, amount: number | null }

Regional cues and examples:
- Canadian retail receipts often include subtotal, GST, HST, PST, QST, TPS, TVQ, total, debit, visa, mastercard, member number, and store names like Costco, Walmart, FreshCo, T&T, Shoppers.
- Vietnamese receipts and invoices may include HOA DON, BIEN LAI, GTGT, VAT, MST, thanh tien, tong cong, tien mat, chuyen khoan, tam tinh, giam gia, and dong currency markers VND, d, or dong.
- Canadian payrolls often include pay period, pay date, gross pay, net pay, CPP/QPP, EI, income tax, vacation pay, taxable benefits, YTD.
- Vietnamese payrolls often include bang luong, ky luong, luong co ban, tong thu nhap, phu cap, thuong, khau tru, BHXH, BHYT, BHTN, thue TNCN, and thuc linh or luong thuc lanh.
- Costco receipts can be long and item-dense. If the merchant is readable as Costco, still extract total, subtotal, tax, date, payment method, and a reasonable set of line items instead of giving up because the page is crowded.
- If the document language appears Vietnamese, prefer VND unless the document clearly states another currency.
- If the document is bilingual or mixed-language, combine the clues instead of rejecting it.

Follow-ups:
- If important fields are missing or ambiguous (example: category, or receipt total/merchant as above), set followUpQuestion to ONE short, friendly question.
- If you have everything you need and the document type is clear, set followUpQuestion to null.

Conversation memory:
- The user message may include a CONVERSATION SUMMARY (financial facts only) plus RECENT CHAT TURNS from earlier today. Use them for continuity (amounts discussed, categories chosen, corrections). If USER LEDGER CONTEXT disagrees with chat memory, trust the ledger as the saved source of truth.

Purchase intent — CRITICAL:
- When the user expresses intent, desire, or a plan to buy something that has NOT been purchased yet (e.g. "I want to buy", "I want to get", "I'm planning to buy/get", "thinking of buying", "should I buy", "can I afford", "I'm going to get"), treat this as a PURCHASE INTENT — NOT a completed transaction.
- For purchase intents: set documentKind "freeform_transaction", set transaction to null (nothing bought), and populate planSuggestion with: title (short item name like "Buy iPhone 15"), description (optional context from user), amountCents (item price in cents if mentioned, else null), currency (use the default wallet currency from WALLETS context), period "none".
- In assistantMessage for purchase intents, always do all four of these: (1) Confirm you've noted it as a planned purchase in their plans. (2) State their wallet balances from the WALLET BALANCES provided in the context. (3) Ask: "Before I can assess the risk, are there other expenses you're expecting before month end that haven't been logged yet — like rent, utilities, food, or anything else?" (4) If you know both the wallet balance and the item cost, give a brief risk note — comfortable (balance > 3× cost), manageable (1–3× cost), tight (< 1× cost).
- Do NOT set planSuggestion if the user already bought the item (past tense: "I bought", "I spent", "I paid") — use the normal transaction flow instead.
- Do NOT set both transaction and planSuggestion at the same time.

assistantMessage should be a concise, human summary of what you understood (1-3 sentences), not raw JSON.`;

const ConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  extractionNote: z.string().optional(),
});

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildUserPrompt(input: {
  message: string;
  hasAttachments: boolean;
  shareContext?: { title?: string; text?: string; url?: string };
  financeContext?: string;
  conversation?: {
    packedFinancialSummary: string | null;
    recentPriorTurns: ConversationTurnForApi[];
  };
}): string {
  const lines: string[] = [];

  lines.push(`TODAY'S DATE: ${todayIso()} — use this as the reference year/month for all dates.`);
  lines.push("");

  if (input.conversation) {
    const pack = (input.conversation.packedFinancialSummary ?? "").trim();
    const turns = input.conversation.recentPriorTurns;
    if (pack.length > 0 || turns.length > 0) {
      lines.push("CONVERSATION CONTEXT (same calendar day)");
      if (pack.length > 0) {
        lines.push("");
        lines.push("Earlier today — financial facts only (auto-summarized):");
        lines.push(pack);
      }
      if (turns.length > 0) {
        lines.push("");
        lines.push("Recent chat (oldest first; current message is below separately):");
        for (const t of turns) {
          const tag = t.role === "user" ? "User" : "Assistant";
          lines.push(`${tag}: ${t.content}`);
          if (t.extractionNote) {
            lines.push(`(Structured extraction excerpt): ${t.extractionNote}`);
          }
        }
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("User message (this request — may repeat the latest user line from recent chat when there are attachments):");
  lines.push(input.message || "(empty)");

  if (input.hasAttachments) {
    lines.push("");
    lines.push("The user attached one or more files.");
    lines.push(
      input.message
        ? "Analyze the attached document(s) together with the user message."
        : "The typed message is empty, but the attached file still needs full analysis. Do not return an empty response just because the user did not type extra text.",
    );
  }

  if (input.shareContext && (input.shareContext.title || input.shareContext.text || input.shareContext.url)) {
    lines.push("");
    lines.push("Optional share metadata from the OS share sheet:");
    if (input.shareContext.title) lines.push(`title: ${input.shareContext.title}`);
    if (input.shareContext.text) lines.push(`text: ${input.shareContext.text}`);
    if (input.shareContext.url) lines.push(`url: ${input.shareContext.url}`);
  }

  if (input.financeContext) {
    lines.push("");
    lines.push(input.financeContext);
  }

  lines.push("");
  lines.push("Return ONLY valid JSON matching the schema described in your system instructions.");
  return lines.join("\n");
}

export async function handleChatInput(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false as const,
      error: "Sign in to chat and save entries to your ledger.",
    };
  }
  const userId = session.user.id;

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

  const packedRaw = String(formData.get("conversationPackedSummary") ?? "").trim();
  const historyRaw = String(formData.get("conversationHistoryJson") ?? "").trim();

  let packedFinancialSummary: string | null = null;
  if (packedRaw.length > 0) {
    packedFinancialSummary = packedRaw.slice(0, 12_000);
  }

  let recentPriorTurns: ConversationTurnForApi[] = [];
  if (historyRaw.length > 0) {
    try {
      const parsed = JSON.parse(historyRaw) as unknown;
      if (Array.isArray(parsed)) {
        const turns: ConversationTurnForApi[] = [];
        for (const item of parsed.slice(0, 39)) {
          const one = ConversationTurnSchema.safeParse(item);
          if (one.success) {
            turns.push({
              role: one.data.role,
              content: one.data.content.slice(0, 16_000),
              extractionNote: one.data.extractionNote?.slice(0, 4000),
            });
          }
        }
        recentPriorTurns = turns;
      }
    } catch {
      recentPriorTurns = [];
    }
  }

  const financeContext = await financeContextLines(prisma, userId);

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

  const prompt = buildUserPrompt({
    message,
    hasAttachments: files.length > 0,
    shareContext,
    financeContext,
    conversation:
      packedFinancialSummary || recentPriorTurns.length > 0
        ? { packedFinancialSummary, recentPriorTurns }
        : undefined,
  });
  const parts: Part[] = [{ text: prompt }];

  const chatTurnId = files.length > 0 ? randomUUID() : null;
  /** In-memory only until a path persists (ledger import staging or a saved freeform transaction). */
  type PreparedChatAttachment = {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
  };
  const preparedAttachments: PreparedChatAttachment[] = [];
  const persistedUploads: { id: string; relativePath: string }[] = [];

  try {
    for (const file of files) {
      const declaredMime = file.type || "application/octet-stream";
      let buffer: Buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));
      const { buffer: processed, mimeType } = await maybeCompressImageForStorage(buffer, declaredMime);
      buffer = processed;
      assertAllowedChatMime(mimeType);
      assertUploadSize(buffer.byteLength);
      preparedAttachments.push({
        buffer,
        mimeType,
        originalFilename: sanitizeOriginalFilename(file.name || "upload"),
      });
      parts.push({
        inlineData: {
          mimeType,
          data: buffer.toString("base64"),
        },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not process attachments.";
    return { ok: false as const, error: msg };
  }

  let persistedAttachmentIds: string[] = [];

  async function rollbackChatUploads() {
    if (persistedAttachmentIds.length === 0) return;
    for (const p of persistedUploads) {
      await unlinkUserMediaRelative(p.relativePath);
    }
    await prisma.storedMedia.deleteMany({ where: { id: { in: persistedAttachmentIds } } });
    persistedUploads.length = 0;
    persistedAttachmentIds = [];
  }

  async function persistPreparedAttachments(
    data: {
      documentKind: string;
      structuredExcerpt: string | null;
      pendingImportJson?: string | null;
      transactionId?: string | null;
    },
  ): Promise<void> {
    for (const att of preparedAttachments) {
      const id = randomUUID();
      const sha256 = sha256Hex(att.buffer);
      const relativePath = await writeUserMediaFile(userId, id, att.mimeType, att.buffer);
      await prisma.storedMedia.create({
        data: {
          id,
          userId,
          mimeType: att.mimeType,
          originalFilename: att.originalFilename,
          byteSize: att.buffer.byteLength,
          sha256,
          relativePath,
          source: "chat",
          chatTurnId,
          documentKind: data.documentKind,
          structuredExcerpt: data.structuredExcerpt,
          ...(data.pendingImportJson != null ? { pendingImportJson: data.pendingImportJson } : {}),
          ...(data.transactionId != null ? { transactionId: data.transactionId } : {}),
        },
      });
      persistedUploads.push({ id, relativePath });
      persistedAttachmentIds.push(id);
    }
  }

  try {
    const result = await model.generateContent(parts);
    const rawText = result.response.text();
    let json: unknown;
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      await rollbackChatUploads();
      return {
        ok: false as const,
        error: "The model returned invalid JSON. Try again.",
      };
    }
    const parsed = GeminiResponseSchema.safeParse(json);
    if (!parsed.success) {
      await rollbackChatUploads();
      return {
        ok: false as const,
        error: "The model returned an unexpected format. Try again.",
      };
    }

    const data = parsed.data;
    const hadFileUpload = files.length > 0;
    let followUpQuestion =
      typeof data.followUpQuestion === "string" && data.followUpQuestion.trim().length > 0
        ? data.followUpQuestion.trim()
        : null;

    if (hadFileUpload) {
      if (data.documentKind === "unknown_document" && !followUpQuestion) {
        followUpQuestion =
          "I’m not sure what this file is. Is it a purchase receipt? Upload a clearer photo or type what you bought and how much.";
      }
      if (
        data.documentKind === "receipt" &&
        data.receipt &&
        typeof data.receipt === "object" &&
        !Array.isArray(data.receipt)
      ) {
        const r = data.receipt as Record<string, unknown>;
        const totalBad = r.total == null || r.total === "";
        const merchantBad = r.merchant == null || r.merchant === "";
        if (totalBad && merchantBad && !followUpQuestion) {
          followUpQuestion =
            "I couldn’t read the store or total from this receipt — can you tell me the merchant and amount, or send a clearer picture?";
        } else if (totalBad && !merchantBad && !followUpQuestion) {
          followUpQuestion = "What was the total on this receipt?";
        } else if (merchantBad && !totalBad && !followUpQuestion) {
          followUpQuestion = "Which store is this receipt from?";
        }
      }
    }

    const structured = {
      documentKind: data.documentKind,
      transaction: data.transaction ?? null,
      receipt: data.receipt ?? null,
      paystub: data.paystub ?? null,
      extractedTextSummary: data.extractedTextSummary ?? null,
      awaitingLedgerDecision: Boolean(
        data.awaitingLedgerDecision ??
          (hadFileUpload && (data.documentKind === "receipt" || isPayrollDocumentKind(data.documentKind))),
      ),
    };

    let structuredExcerpt: string | null = null;
    try {
      structuredExcerpt = JSON.stringify({
        documentKind: data.documentKind,
        transactionPresent: Boolean(data.transaction),
        receiptPresent: Boolean(data.receipt),
        paystubPresent: Boolean(data.paystub),
      }).slice(0, 4000);
    } catch {
      structuredExcerpt = null;
    }

    let pendingDocumentImport: PendingDocumentImport | undefined;
    let pendingImportJson: string | null = null;

    const isFinancialUpload =
      hadFileUpload &&
      chatTurnId &&
      (data.documentKind === "receipt" || isPayrollDocumentKind(data.documentKind));

    if (isFinancialUpload) {
      const proposed =
        data.documentKind === "receipt" &&
        data.receipt &&
        typeof data.receipt === "object" &&
        !Array.isArray(data.receipt)
          ? (data.receipt as Record<string, unknown>)
          : isPayrollDocumentKind(data.documentKind) &&
              data.paystub &&
              typeof data.paystub === "object" &&
              !Array.isArray(data.paystub)
            ? (data.paystub as Record<string, unknown>)
            : null;
      if (proposed) {
        const summaryFromModel =
          typeof data.extractedTextSummary === "string" ? data.extractedTextSummary.trim() : "";
        const extracted =
          summaryFromModel.length > 0
            ? summaryFromModel
            : data.assistantMessage.trim().slice(0, 2000);
        const pendingKind: PendingDocumentImport["documentKind"] =
          data.documentKind === "receipt"
            ? "receipt"
            : data.documentKind === "canadian_paystub"
              ? "canadian_paystub"
              : "payroll_document";
        const payload = {
          version: PENDING_IMPORT_VERSION,
          chatTurnId,
          documentKind: pendingKind,
          extractedTextSummary: extracted,
          proposed,
        };
        pendingImportJson = JSON.stringify(payload).slice(0, 500_000);
        const splitItems =
          Array.isArray(data.receiptSplit) && data.receiptSplit.length > 0
            ? data.receiptSplit.map((item) => ({
                description: String(item.description ?? ""),
                category: String(item.category ?? "Other"),
                amount: Number(item.amount ?? 0),
                currency: String(item.currency ?? "CAD"),
                direction: item.direction === "in" ? ("in" as const) : ("out" as const),
              }))
            : undefined;
        pendingDocumentImport = {
          chatTurnId,
          documentKind: pendingKind,
          extractedTextSummary: extracted,
          splitItems,
        };
      }
    }

    if (pendingImportJson && preparedAttachments.length > 0) {
      await persistPreparedAttachments({
        documentKind: data.documentKind,
        structuredExcerpt,
        pendingImportJson,
      });
    }

    let assistantMessage =
      typeof data.assistantMessage === "string" && data.assistantMessage.trim().length > 0
        ? data.assistantMessage.trim()
        : "I processed your upload but didn’t get a readable summary back. Try again, or add a short note about what the file is.";
    if (pendingDocumentImport) {
      assistantMessage = `${assistantMessage}\n\n---\nFrom your file (readout):\n${pendingDocumentImport.extractedTextSummary}\n\n---\nUse the buttons under the chat to save this to your ledger as read, or edit details first. Edits are stored with the image for optional future training export.`;
    }
    if (
      data.documentKind === "freeform_transaction" &&
      data.transaction &&
      typeof data.transaction === "object" &&
      !Array.isArray(data.transaction)
    ) {
      try {
        const rawStructuredJson = JSON.stringify({
          documentKind: data.documentKind,
          transaction: data.transaction,
        });
        const persisted = await persistFreeformLedgerEntry(
          prisma,
          userId,
          data.transaction as Record<string, unknown>,
          rawStructuredJson,
        );
        if (persisted.saved && persisted.detail) {
          assistantMessage = `${assistantMessage}\n\n${persisted.detail}`;
        }
        if (
          persisted.saved &&
          persisted.transactionId &&
          preparedAttachments.length > 0 &&
          persistedAttachmentIds.length === 0
        ) {
          await persistPreparedAttachments({
            documentKind: data.documentKind,
            structuredExcerpt,
            transactionId: persisted.transactionId,
          });
        }
      } catch {
        /* ledger write is best-effort; chat reply still returns */
      }
    }

    let planCreated = false;
    if (
      data.planSuggestion &&
      typeof data.planSuggestion === "object" &&
      data.planSuggestion.title?.trim()
    ) {
      const ps = data.planSuggestion;
      try {
        const planDelegate = (prisma as unknown as { financialPlan?: { create: (args: unknown) => Promise<unknown> } })
          .financialPlan;
        if (planDelegate?.create) {
          await planDelegate.create({
            data: {
              userId,
              kind: "spending_budget",
              title: ps.title.trim().slice(0, 200),
              description: ps.description?.trim().slice(0, 2000) ?? null,
              amountCents: typeof ps.amountCents === "number" ? Math.round(ps.amountCents) : null,
              currency: ((ps.currency ?? "CAD").toUpperCase().slice(0, 3)),
              period: ps.period ?? "none",
              targetDate: ps.targetDate ? new Date(ps.targetDate) : null,
              sortOrder: 0,
            },
          });
          planCreated = true;
        }
      } catch {
        /* best-effort — chat reply still returns */
      }
    }

    return {
      ok: true as const,
      assistantMessage,
      structured,
      followUpQuestion,
      ...(pendingDocumentImport ? { pendingDocumentImport } : {}),
      ...(planCreated ? { planCreated: true as const } : {}),
    };
  } catch (error) {
    await rollbackChatUploads();
    const messageText =
      error instanceof Error ? error.message : "Unknown error calling Gemini.";
    return {
      ok: false as const,
      error: messageText,
    };
  }
}
