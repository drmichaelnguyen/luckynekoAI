"use server";

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { PENDING_IMPORT_VERSION } from "@/lib/document-import/pending-import-shared";
import { auth } from "@/auth";
import {
  ledgerMatchesContextBlock,
  synthesizeAnalyticsAnswer,
  synthesizeLedgerAnswer,
} from "@/lib/ai/data-answer";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import {
  chooseChatPrimary,
  chooseChatRouterModels,
  orderedProviders,
  parseModelJson,
} from "@/lib/ai/model-router";
import { recordAiRequestLog, usageFromGeminiResult, type AiUsageMetrics } from "@/lib/ai/telemetry";
import { loadAdminRuntimeSettings, resolveProviderChoice } from "@/lib/admin-runtime-settings";
import { getLedgerDashboardAction, type DashboardRange } from "@/actions/dashboard";
import { persistFreeformLedgerEntry, applyLedgerEdit, previewLedgerEdit, resolveTransactionNotes } from "@/lib/finance/persist-from-chat";
import { persistPaystubLedgerEntry } from "@/lib/finance/persist-receipt-paystub";
import { enrichReceiptWithLineItemCategories } from "@/lib/finance/line-item-category";
import { resolveAnalyticsCategoryScope as resolveAnalyticsCategoryScopeFromRows } from "@/lib/finance/analytics-query";
import {
  looksLikeLedgerLookupRequest,
  recentTransactionsContextBlock,
  searchLedger,
} from "@/lib/finance/ledger-query";
import { applyPlanSuggestion } from "@/lib/finance/plan-suggestion";
import { financeContextLines } from "@/lib/finance/seed";
import {
  detectLanguageFromMessage,
  detectVerbositySignal,
  detectExplicitPreference,
  loadChatPreferences,
  saveChatPreferences,
  mergePreferences,
} from "@/lib/learning/chat-preferences";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n/config";
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
import { buildTransactionOriginChatJson } from "@/lib/chat/transaction-origin";
import { prisma } from "@/lib/prisma";
import type { PendingDocumentImport, PendingLedgerEdit } from "@/types/chat";
import type { TransactionImportItem } from "@/types/chat";
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
      "transaction_list_capture",
      "analytics",
      "unknown_document",
      "ledger_edit",
    ]),
    transaction: z.record(z.string(), z.unknown()).nullable().optional(),
    transactionList: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
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
    /**
     * Populated when the user replies with a cadence decision for a pending ledger confirmation
     * (e.g. "yearly", "every 2 weeks", "one-time"). Applied server-side against the most recent
     * matching pending transaction.
     */
    pendingRecurrenceUpdate: z
      .object({
        merchantHint: z.string().nullable().optional(),
        cadenceText: z.string(),
        nextReminderAt: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    /** Populated when the user explicitly asks to edit, modify, or add a comment to a past transaction. */
    ledgerEdit: z
      .object({
        merchantHint: z.string().nullable().optional(),
        dateHint: z.string().nullable().optional(),
        walletHint: z.string().nullable().optional(),
        categoryHint: z.string().nullable().optional(),
        memoHint: z.string().nullable().optional(),
        newAmount: z.number().nullable().optional(),
        newMemo: z.string().nullable().optional(),
        newCategory: z.string().nullable().optional(),
        newMerchant: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    /** Populated when the edit could affect multiple matching rows and needs user confirmation first. */
    pendingLedgerEdit: z
      .object({
        merchantHint: z.string().nullable().optional(),
        dateHint: z.string().nullable().optional(),
        walletHint: z.string().nullable().optional(),
        categoryHint: z.string().nullable().optional(),
        memoHint: z.string().nullable().optional(),
        newAmount: z.number().nullable().optional(),
        newMemo: z.string().nullable().optional(),
        newCategory: z.string().nullable().optional(),
        newMerchant: z.string().nullable().optional(),
        matchedCount: z.number().int().min(1),
        scopeLabel: z.string(),
      })
      .nullable()
      .optional(),
    analyticsRequest: z
      .object({
        range: z.enum(["30d", "month", "all", "auto"]).optional(),
        focus: z.enum(["overview", "spending", "income", "categories", "wallets", "merchants"]).optional(),
        needChart: z.boolean().optional(),
      })
      .nullable()
      .optional(),
    requiresComplexReasoning: z.boolean().optional(),
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

const SYSTEM_INSTRUCTION_BASE = `You are NekoZeni, a friendly lucky-cat-themed finance assistant for people in Canada and Vietnam. You are fully bilingual and speak fluidly in both English and Vietnamese. Reply naturally in the language the user speaks to you (or bilingual if requested).
You MUST respond with JSON only (no markdown fences).

Your JSON MUST match this shape (optional keys only when relevant):
{
  "documentKind": "freeform_transaction" | "receipt" | "payroll_document" | "transaction_list_capture" | "analytics" | "unknown_document" | "ledger_edit",
  "transaction": null | object,
  "transactionList": null | object[],
  "receipt": null | object,
  "paystub": null | object,
  "assistantMessage": string,
  "followUpQuestion": string | null,
  "extractedTextSummary": string | null,
  "awaitingLedgerDecision": boolean,
  "receiptSplit": null | [{ "description": string, "category": string, "amount": number, "currency": string, "direction": "in"|"out" }],
  "planSuggestion": null | { "title": string, "description": string | null, "amountCents": number | null, "currency": string, "period": "none" | "monthly" | "yearly" },
  "pendingRecurrenceUpdate": null | { "merchantHint": string | null, "cadenceText": string, "nextReminderAt": string | null },
  "ledgerEdit": null | { "merchantHint": string | null, "dateHint": string | null, "walletHint": string | null, "categoryHint": string | null, "memoHint": string | null, "newAmount": number | null, "newMemo": string | null, "newCategory": string | null, "newMerchant": string | null },
  "analyticsRequest": null | { "range": "30d" | "month" | "all" | "auto", "focus": "overview" | "spending" | "income" | "categories" | "wallets" | "merchants", "needChart": boolean },
  "requiresComplexReasoning": boolean
}

Rules:
- If the user asks for complex financial planning, risk analysis, or deep reasoning that you cannot confidently satisfy, set requiresComplexReasoning to true.
- The user message may include USER PREFERENCES (how to address them in chat) and FINANCIAL PLANS (spending budgets and savings goals). Follow those when giving advice; do not ignore a stated monthly cap or savings target without asking first.
- Choose exactly one primary extraction target: populate ONLY ONE of transaction/transactionList/receipt/paystub/ledgerEdit; set the others to null.
- If the user asks for analytics, summaries, trends, comparisons, spending breakdowns, income analysis, or wants a chart/dashboard, set documentKind to "analytics" and populate analyticsRequest with the best fit range and focus. Do not fill transaction, receipt, paystub, or ledgerEdit in that case.
- Do NOT use analytics for concrete ledger lookups such as "how much did I spend on Uber last month", "when did I get an oil change", "find my Costco transactions", "show my groceries spending this year", or "what did I spend in my Main wallet". The server searches the ledger and synthesizes an answer from matching rows.
- For analytics requests, keep assistantMessage concise and friendly; the server will fetch the ledger data and render the interactive chart in chat.
- If the user explicitly asks to edit, update, change category, change merchant, or add a comment/note to a PAST or EXISTING transaction (e.g., "add a note to my Uber ride", "change the amount of my Tim Hortons to $5", "this should be in tax category", "change merchant to CRA"), use documentKind "ledger_edit" and populate ledgerEdit. Use merchantHint/dateHint/walletHint/categoryHint/memoHint to identify EXISTING rows, and use newAmount/newMemo/newCategory/newMerchant for the requested new values. For newMemo: when the user asks to ADD a note, set newMemo to the new text (the server appends to any existing memo); when they ask to REPLACE or change the note entirely, set newMemo to the full replacement text. Example: if the user says insurance in Car Rental should be ICBC, use merchantHint "Insurance", walletHint "Car Rental", categoryHint "Insurance", and newMerchant "ICBC".
- If the user only typed text describing a purchase or income/payroll entry, use documentKind "freeform_transaction" and populate transaction.
- If the uploaded file is a clear retail or service purchase receipt or bill (you can read totals and context), use documentKind "receipt" and populate receipt with structured expense data suitable for database insertion.
- Use documentKind "payroll_document" only for an uploaded payroll or payslip document from Canada or Vietnam; typed salary/paycheck/payroll text must be "freeform_transaction".
- If the uploaded file is a wallet or Apple Pay activity screenshot showing MULTIPLE completed transactions in a list, use documentKind "transaction_list_capture" and populate transactionList with one transaction object per visible line item.
- If you cannot confidently classify the file, use documentKind "unknown_document", set all extraction objects to null, explain briefly in assistantMessage, and ask what it is in followUpQuestion.

Uploaded files (images/PDF) — pipeline before anything hits the ledger:
1) Classify first: is this a financial document about money (retail/service receipt, bill, paid invoice, payroll document, bank or card slip with amounts)? If clearly NO, use documentKind "unknown_document", all extraction objects null, stop — do not pretend it is a receipt.
2) If YES: use documentKind "receipt", "payroll_document", or "transaction_list_capture" and populate only that target; use null for unreadable fields instead of guessing.
3) extractedTextSummary: when documentKind is receipt or payroll_document AND the user attached a file, you MUST set this to a plain-text, human-readable readout of the document (merchant lines, dates, line items, taxes, totals, payment method or payroll sections) — like reading the page aloud, not JSON.
4) awaitingLedgerDecision: set true when there is a file attachment and documentKind is receipt, payroll_document, or transaction_list_capture. The user must explicitly confirm in the app before a ledger row is created from that upload; do not state that the document is already saved in their ledger from the file alone.
5) Typed-only purchases (no file) use freeform_transaction; omit awaitingLedgerDecision or set false.
6) Amount normalization matters: return numeric amounts, not formatted strings. For VND, return whole-dong numbers like 1250000. For CAD, return decimal numbers like 47.82.
7) Dates should be normalized to ISO yyyy-mm-dd whenever the document makes the date reasonably clear.
8) Currency conversion: the USER LEDGER CONTEXT includes live EXCHANGE RATES and a "Preferred currency" field.
9) Category splitting: if a receipt or bill clearly contains line items across DIFFERENT categories (e.g. groceries + electronics + clothing in one Costco trip, or a utility bill mixing internet + phone), populate receiptSplit with one entry per category group — each with description, category (matching the user's CATEGORIES list), amount, currency, and direction. The individual amounts must sum to the total. Set awaitingLedgerDecision true so the user can review and confirm each split. If everything belongs to a single category, leave receiptSplit null and use the normal receipt object with category set from the line items. Read product descriptions on the receipt to decide category — a supermarket receipt with food items is Groceries even if the store also sells electronics elsewhere in the store. If the user states an amount in a foreign currency (different from their preferred currency), convert it to their preferred currency using those rates and set the transaction/receipt currency to the preferred currency. Always mention both the original amount and the converted amount in assistantMessage (e.g. "50 USD ≈ 68.20 CAD"). If no exchange rate context is available, record the amount in the original currency and note the conversion is needed.

Transaction object fields (use null for unknown):
- amount: number | null (major currency units, positive for magnitude; use direction for sign semantics)
- currency: string | null (default CAD when implied)
- merchant: string | null
- category: string | null (prefer an existing CATEGORY name from the USER LEDGER CONTEXT; if nothing fits well, you may propose a new category or a subcategory path like "Dining > Sushi")
- transactionDate: string | null (ISO yyyy-mm-dd if possible)
- notes: string | null — saved in the ledger as the transaction memo (details/note field in the app). ALWAYS populate when the user mentions purchased items, purpose, comments, or explicitly asks to put something in the note/memo/details. Put item names and extra context here, not only in assistantMessage. "memo" and "details" are accepted aliases but prefer "notes".
- walletLabel: string | null (must match a WALLET name from USER LEDGER CONTEXT; if unsure use "Main")
- direction: "in" | "out" | null — "in" for income, refunds to the user, transfers in; "out" for spending
- recurrence: "one_time" | "recurrent" | "unknown"
- needsUserConfirm: boolean — true if this might be a repeating bill, loan, subscription, or utility charge
- userConfirmReason: string | null — short reason when needsUserConfirm is true
- payeeKind: "purchase" | "bill" | "loan" | "subscription" | "utility" | "income" | "transfer" | null

transactionList rules for Apple Pay / wallet screenshots:
- transactionList items use the SAME fields as Transaction object above.
- One item per visible completed transaction row.
- Merchant should be the displayed merchant or service name.
- amount should be positive magnitude; use direction for sign semantics.
- For Apple Pay / wallet activity screenshots, direction is usually "out" unless the screenshot clearly shows a refund or incoming transfer.
- Use today’s year when the screenshot only shows relative timing like "44 minutes ago" or "Yesterday"; convert "Yesterday" to the actual ISO date relative to TODAY'S DATE.
- If category is unclear, choose the closest category from USER LEDGER CONTEXT or use "Other". If the best fit is missing, you may propose a new category or a "Parent > Child" subcategory path.
- Grocery stores and supermarkets (names containing "market", "mart", "supermarket", "grocery", or chains like Costco, Walmart, T&T) should use "Groceries > Supermarket" — not "Other".
- If fewer than 1 complete transaction row is legible, do not use transaction_list_capture.

Pending-recurrence replies (pendingRecurrenceUpdate):
- The USER LEDGER CONTEXT may list PENDING CONFIRMATIONS — transactions we already saved but are waiting on the user to decide if they repeat. If the user's new message is answering that ("yes yearly", "every 2 weeks", "one-time", "Cloudflare is yearly", etc.), populate pendingRecurrenceUpdate.
- Only use pendingRecurrenceUpdate when the user gives an explicit cadence or a clear one-time/no-repeat answer. Do not guess from generic cleanup language, frustration, or unrelated instructions.
- merchantHint: a short match for the pending row (merchant or memo substring). Leave null if there is only one pending row or the user did not name one.
- cadenceText: exactly what the user said, verbatim ("yearly", "one-time", "every 2 weeks", "every 15th"). The server parses it.
- nextReminderAt: ISO yyyy-mm-dd if the user named a date for the next reminder, else null.
- When you populate pendingRecurrenceUpdate, set transaction to null and documentKind to "freeform_transaction" unless they also described a new purchase in the same message.

Bookkeeping rules for freeform_transaction:
- Salary, paycheck, payroll, bonus, commission, or employer payments: set direction "in", payeeKind "income", merchant to the employer name (e.g. "Prenuvo"), category to the closest Income category (e.g. "Income > Salary"), recurrence "recurrent" with needsUserConfirm true when the user implies it repeats (monthly pay), otherwise "one_time". Never treat a stated salary/paycheck as a ledger search or analytics request.
- When the user describes everyday shopping, use recurrence "one_time" and needsUserConfirm false unless unclear.
- For rent, mortgage, car loan, BNPL, phone plan, streaming, insurance, or utilities, prefer recurrence "recurrent" or "unknown" with needsUserConfirm true and a friendly userConfirmReason.
- Always pick the closest category from the provided list when it fits. If none fit, you may propose a new category or a "Parent > Child" subcategory path instead of forcing "Other".
- When the user names a supermarket, grocery store, or market (e.g. "88 Super Market", "Costco", "T&T"), categorize from what they bought: food/grocery items → "Groceries > Supermarket"; medicine → "Health > Pharmacy". Put purchased item names in notes when helpful.

Receipt object fields (use null for unknown):
- total: number | null
- currency: string | null
- merchant: string | null
- category: string | null (infer from lineItems when possible — e.g. milk, bread, produce → "Groceries > Supermarket"; medicine → "Health > Pharmacy")
- purchaseDate: string | null (ISO yyyy-mm-dd if possible)
- subtotal: number | null
- taxTotal: number | null
- paymentMethod: string | null
- lineItems: array of { description: string | null, quantity: number | null, unitPrice: number | null, lineTotal: number | null } — extract as many readable product lines as you can; category should follow what was bought, not just the store name

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
- When RECENT LEDGER ROWS are present, use them to answer lookup/history questions (dates, merchants, memos). Quote specific dates from those rows; never guess transactions that are not listed.

Purchase intent — CRITICAL:
- When the user expresses intent, desire, or a plan to buy something that has NOT been purchased yet (e.g. "I want to buy", "I want to get", "I'm planning to buy/get", "thinking of buying", "should I buy", "can I afford", "I'm going to get"), treat this as a PURCHASE INTENT — NOT a completed transaction.
- For purchase intents: set documentKind "freeform_transaction", set transaction to null (nothing bought), and populate planSuggestion with: title (short item name like "Buy iPhone 15"), description (optional context from user), amountCents (item price in cents if mentioned, else null), currency (use the default wallet currency from WALLETS context), period "none".
- In assistantMessage for purchase intents, always do all four of these: (1) Confirm you've noted it as a planned purchase in their plans. (2) State their wallet balances from the WALLET BALANCES provided in the context. (3) Ask: "Before I can assess the risk, are there other expenses you're expecting before month end that haven't been logged yet — like rent, utilities, food, or anything else?" (4) If you know both the wallet balance and the item cost, give a brief risk note — comfortable (balance > 3× cost), manageable (1–3× cost), tight (< 1× cost).
- Do NOT set planSuggestion if the user already bought the item (past tense: "I bought", "I spent", "I paid") — use the normal transaction flow instead.
- If the message is just an item and price with no intent wording, treat it as a completed purchase (freeform_transaction), not a plan. Only use planSuggestion when intent wording is explicit.
- Do NOT set both transaction and planSuggestion at the same time.
- Plans labeled PLANNED, NOT PURCHASED are not transactions. Never describe them as something the user already bought.

assistantMessage should be a concise, human summary of what you understood (1-3 sentences), not raw JSON.`;

type ResponseLanguage = "English" | "Vietnamese";

function responseLanguageName(locale: Locale): ResponseLanguage {
  return locale === "vi" ? "Vietnamese" : "English";
}

function languageText(responseLanguage: ResponseLanguage, english: string, vietnamese: string): string {
  return responseLanguage === "Vietnamese" ? vietnamese : english;
}

function resolveResponseLanguage(locale: Locale, userMessage: string): ResponseLanguage {
  const detected = detectLanguageFromMessage(userMessage);
  if (detected === "vi") return "Vietnamese";
  if (detected === "en") return "English";
  return responseLanguageName(locale);
}

type AnalyticsDashboardData = Omit<Extract<Awaited<ReturnType<typeof getLedgerDashboardAction>>, { ok: true }>, "ok">;

function normalizeAnalyticsText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAnalyticsRequest(message: string): boolean {
  const normalized = normalizeAnalyticsText(message);
  if (!normalized) return false;
  if (looksLikeLedgerLookupRequest(message)) return false;
  return /\b(analytics|analyse|analyze|summary|summarize|summarise|trend|trends|chart|graph|dashboard|insight|insights|breakdown|compare|comparison|overview)\b/.test(
    normalized,
  );
}

function resolveAnalyticsRange(message: string, hint?: "30d" | "month" | "all" | "auto"): DashboardRange {
  if (hint === "30d" || hint === "month" || hint === "all") return hint;
  const normalized = normalizeAnalyticsText(message);
  if (/\ball time\b|\beverything\b|\blifetime\b|\boverall\b/.test(normalized)) return "all";
  if (/\bthis month\b|\bcurrent month\b|\bmonth to date\b|\bmtd\b/.test(normalized)) return "month";
  if (/\blast 30 days\b|\b30d\b|\b30 days\b|\brecent\b/.test(normalized)) return "30d";
  if (/\blast month\b/.test(normalized)) return "month";
  return "30d";
}

function resolveAnalyticsFocus(
  message: string,
  hint?: "overview" | "spending" | "income" | "categories" | "wallets" | "merchants",
): "overview" | "spending" | "income" | "categories" | "wallets" | "merchants" {
  if (hint) return hint;
  const normalized = normalizeAnalyticsText(message);
  if (/\b(income|revenue|earnings|money in|inflow)\b/.test(normalized)) return "income";
  if (/\b(wallet|account|cash)\b/.test(normalized)) return "wallets";
  if (/\b(merchant|payee|vendor)\b/.test(normalized)) return "merchants";
  if (/\b(category|categories|groceries|dining|transportation|shopping)\b/.test(normalized)) return "categories";
  if (/\b(spend|spending|expense|expenses|outflow|spent)\b/.test(normalized)) return "spending";
  return "overview";
}

function extractAnalyticsYear(message: string): number | null {
  const normalized = normalizeAnalyticsText(message);
  const match = normalized.match(/\b(20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 3000 ? year : null;
}

function resolveAnalyticsWindow(message: string, hint?: "30d" | "month" | "all" | "auto"): {
  range: DashboardRange;
  fromIso: string | null;
  toIso: string | null;
  label: string;
} {
  const normalized = normalizeAnalyticsText(message);
  const year = extractAnalyticsYear(message);
  if (year !== null) {
    return {
      range: "all",
      fromIso: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString(),
      toIso: new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)).toISOString(),
      label: String(year),
    };
  }

  if (/\blast month\b/.test(normalized)) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(from);
    return { range: "month", fromIso: from.toISOString(), toIso: to.toISOString(), label };
  }

  const range = resolveAnalyticsRange(message, hint);
  if (range === "month") {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(from);
    return { range, fromIso: from.toISOString(), toIso: to.toISOString(), label };
  }
  if (range === "30d") {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { range, fromIso: from.toISOString(), toIso: to.toISOString(), label: "Last 30 days" };
  }
  return {
    range,
    fromIso: null,
    toIso: null,
    label: "All time",
  };
}

function analyticsNeedsClarification(
  message: string,
  request?: { range?: "30d" | "month" | "all" | "auto"; focus?: "overview" | "spending" | "income" | "categories" | "wallets" | "merchants" } | null,
): boolean {
  const normalized = normalizeAnalyticsText(message);
  if (!normalized) return false;
  if (!looksLikeAnalyticsRequest(message)) return false;
  if (extractAnalyticsYear(message) !== null) return false;

  const hasRange = /\b(30d|30 days|last 30 days|this month|month to date|mtd|last month|all time|everything|year to date|ytd)\b/.test(
    normalized,
  );
  const hasFocus = /\b(spend|spending|income|revenue|category|categories|wallet|wallets|merchant|merchant|trend|comparison|compare|breakdown)\b/.test(
    normalized,
  );
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  if (request?.focus && request.focus !== "overview") return false;
  if (request?.range && request.range !== "auto") return false;
  return tokenCount <= 4 || (!hasRange && !hasFocus);
}

function analyticsClarificationQuestion(responseLanguage: ResponseLanguage): string {
  return responseLanguage === "Vietnamese"
    ? "Bạn muốn xem phần nào rõ hơn: chi tiêu, thu nhập, danh mục, ví, hay từng người nhận tiền? Nếu muốn, mình cũng có thể đổi khung thời gian sang 30 ngày, tháng này, hoặc toàn bộ."
    : "What should I drill into next: spending, income, categories, wallets, or merchants? I can also switch the range to 30 days, this month, or all time.";
}

function pickTopCategory(
  dashboard: AnalyticsDashboardData,
  focus: "overview" | "spending" | "income" | "categories" | "wallets" | "merchants",
): (typeof dashboard.byCategory)[number] | null {
  const rows = dashboard.byCategory.filter((row) => row.expenseCents > 0 || row.incomeCents > 0);
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => (focus === "income" ? b.incomeCents - a.incomeCents : b.expenseCents - a.expenseCents))[0] ?? null;
}

function pickTopWallet(
  dashboard: AnalyticsDashboardData,
): (typeof dashboard.byWallet)[number] | null {
  const rows = dashboard.byWallet.filter((row) => row.expenseCents > 0 || row.incomeCents > 0);
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents))[0] ?? null;
}

type AnalyticsCategoryScope = {
  categoryIds: string[];
  label: string;
  matchedNames: string[];
  expenseCents: number;
};

function buildAnalyticsAssistantMessage(input: {
  responseLanguage: ResponseLanguage;
  dashboard: AnalyticsDashboardData;
  focus: "overview" | "spending" | "income" | "categories" | "wallets" | "merchants";
  categoryScope: AnalyticsCategoryScope | null;
}): string {
  const { responseLanguage, dashboard, focus, categoryScope } = input;
  const topCategory = pickTopCategory(dashboard, focus);
  const topWallet = pickTopWallet(dashboard);
  const topMerchant = dashboard.topMerchants[0] ?? null;

  const spendingCents = categoryScope?.expenseCents ?? dashboard.totals.expenseCents;
  const spending = `${dashboard.displayCurrency} ${(spendingCents / 100).toFixed(2)}`;
  const income = `${dashboard.displayCurrency} ${(dashboard.totals.incomeCents / 100).toFixed(2)}`;
  const netText = `${dashboard.totals.netCents < 0 ? "−" : ""}${dashboard.displayCurrency} ${(Math.abs(
    dashboard.totals.netCents,
  ) / 100).toFixed(2)}`;

  const summaryLine =
    categoryScope != null
      ? responseLanguage === "Vietnamese"
        ? `Mình đã mở phân tích cho ${dashboard.rangeLabel}. Bạn đã chi ${spending} cho ${categoryScope.label}.`
        : `I pulled up your analytics for ${dashboard.rangeLabel}. You spent ${spending} on ${categoryScope.label}.`
      : responseLanguage === "Vietnamese"
        ? `Mình đã mở phân tích cho ${dashboard.rangeLabel}. Bạn đã chi ${spending}, thu ${income}, và số ròng là ${netText}.`
        : `I pulled up your analytics for ${dashboard.rangeLabel}. You spent ${spending}, earned ${income}, and your net is ${netText}.`;

  const detailLine =
    categoryScope != null
      ? responseLanguage === "Vietnamese"
        ? `Mình đang chỉ tính các danh mục: ${categoryScope.matchedNames.join(", ")}.`
        : `I am only counting these categories: ${categoryScope.matchedNames.join(", ")}.`
      : responseLanguage === "Vietnamese"
        ? `${topCategory ? `Danh mục lớn nhất là ${topCategory.name}. ` : ""}${topWallet ? `Ví hoạt động nhiều nhất là ${topWallet.name}. ` : ""}${topMerchant ? `Giao dịch lớn nhất gần đây là ${topMerchant.label}. ` : ""}Biểu đồ bên dưới có thể bấm để xem từng phần.`
        : `${topCategory ? `Top category: ${topCategory.name}. ` : ""}${topWallet ? `Most active wallet: ${topWallet.name}. ` : ""}${topMerchant ? `Top merchant: ${topMerchant.label}. ` : ""}The chart below is interactive, so you can tap into categories and wallets.`;

  return `${summaryLine}\n\n${detailLine}`.trim();
}

function buildSystemInstruction(locale: Locale, responseLanguage: ResponseLanguage): string {
  const localeHint =
    locale === "vi"
      ? [
          "The user selected Vietnamese in the app.",
          "Vietnamese is the default response language.",
        ].join(" ")
      : [
          "The user selected English in the app.",
          "English is the default response language.",
        ].join(" ");

  return `${SYSTEM_INSTRUCTION_BASE}

Locale and chat language:
- ${localeHint}
- For this specific reply, assistantMessage and followUpQuestion MUST be in ${responseLanguage}.
- The selected app language is the default when the user message language is unclear or there is only an attachment.
- If the user clearly switches to another language during chat, follow that current message's language for the reply.`;
}

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
  appLocale: Locale;
  responseLanguage: ResponseLanguage;
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
  lines.push("RESPONSE LANGUAGE OVERRIDE:");
  lines.push(`- App language setting: ${responseLanguageName(input.appLocale)}.`);
  lines.push(`- Reply in: ${input.responseLanguage}.`);
  lines.push("- Apply this to assistantMessage and followUpQuestion.");

  lines.push("");
  lines.push("Return ONLY valid JSON matching the schema described in your system instructions.");
  return lines.join("\n");
}

async function detectAndSaveChatPreferences(
  db: typeof prisma,
  userId: string,
  userMessage: string,
  assistantMessage: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  const language = detectLanguageFromMessage(userMessage);
  const verbosity = detectVerbositySignal(userMessage, assistantMessage);
  const explicit = detectExplicitPreference(userMessage);
  if (!language && !verbosity && !explicit) return;

  const current = await loadChatPreferences(db, userId);
  const merged = mergePreferences(current, { language, verbosity, explicitInstruction: explicit });
  if (merged) await saveChatPreferences(db, userId, merged);
}

export async function reportChatClientDebugAction(payload: {
  hypothesisId: string;
  message: string;
  data: Record<string, unknown>;
}) {
  // #region agent log
  fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
    body: JSON.stringify({
      sessionId: "51b9f5",
      runId: "pre-fix",
      hypothesisId: payload.hypothesisId,
      location: "chat.ts:reportChatClientDebugAction",
      message: payload.message,
      data: payload.data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return { ok: true as const };
}

export async function handleChatInput(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    // #region agent log
    fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
      body: JSON.stringify({
        sessionId: "51b9f5",
        runId: "pre-fix",
        hypothesisId: "B",
        location: "chat.ts:handleChatInput",
        message: "chat action unauthenticated",
        data: { hasSession: false },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return {
      ok: false as const,
      error: "Sign in to chat and save entries to your ledger.",
    };
  }
  const userId = session.user.id;
  const adminSettings = await loadAdminRuntimeSettings();
  const localeCookieStore = await cookies();
  const cookieLocale = parseLocale(localeCookieStore.get(LOCALE_COOKIE)?.value);

  const message = String(formData.get("message") ?? "").trim();
  const locale = parseLocale(String(formData.get("locale") ?? cookieLocale));
  const responseLanguage = resolveResponseLanguage(locale, message);
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
  const allFileEntries = formData.getAll("files");

  // #region agent log
  fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
    body: JSON.stringify({
      sessionId: "51b9f5",
      runId: "pre-fix",
      hypothesisId: "A-D-E",
      location: "chat.ts:handleChatInput:entry",
      message: "chat action reached",
      data: {
        messageLen: message.length,
        fileCount: files.length,
        rawFileCount: allFileEntries.length,
        files: allFileEntries.map((entry) =>
          entry instanceof File
            ? {
                size: entry.size,
                type: entry.type || "empty",
                nameLen: (entry.name || "").length,
                ext: (entry.name || "").split(".").pop()?.slice(0, 8) || "",
              }
            : { kind: typeof entry },
        ),
        clientMeta: String(formData.get("debugUploadMeta") ?? "").slice(0, 500),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!message && files.length === 0) {
    return {
      ok: false as const,
      error: "Add a message or attach a file.",
    };
  }

  let ledgerSearchAttempt: Awaited<ReturnType<typeof searchLedger>> = null;
  if (files.length === 0 && message) {
    const userPrefs = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    const displayCurrency = (userPrefs?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);
    ledgerSearchAttempt = await searchLedger(prisma, {
      userId,
      message,
      displayCurrency,
      responseLanguage,
    });
    const ledgerNotFound =
      ledgerSearchAttempt != null &&
      ledgerSearchAttempt.result.txCount === 0 &&
      (ledgerSearchAttempt.formattedText.includes("couldn't find") ||
        ledgerSearchAttempt.formattedText.includes("could not find") ||
        ledgerSearchAttempt.formattedText.includes("không tìm thấy"));
    const planFallback = ledgerSearchAttempt != null && ledgerSearchAttempt.plans.length > 0 && ledgerSearchAttempt.result.txCount === 0;
    if (ledgerSearchAttempt && (!ledgerNotFound || planFallback)) {
      const routerModels = chooseChatRouterModels({
        hasAttachments: false,
        message,
        hasConversationContext: false,
        nineRouterAvailable: has9RouterConfig(),
        miniModel: adminSettings.routing.nineRouterMiniModel,
        largeModel: adminSettings.routing.nineRouterModel,
      });
      const assistantMessage = planFallback || !has9RouterConfig()
        ? ledgerSearchAttempt.formattedText
        : await synthesizeLedgerAnswer({
            userId,
            userMessage: message,
            responseLanguage,
            displayCurrency,
            query: ledgerSearchAttempt.query,
            result: ledgerSearchAttempt.result,
            templateFallback: ledgerSearchAttempt.formattedText,
            nineRouterUrl: adminSettings.routing.nineRouterUrl,
            models: routerModels,
          });

      detectAndSaveChatPreferences(
        prisma,
        userId,
        message,
        assistantMessage,
        adminSettings.learning.enableChatPreferenceLearning,
      ).catch(() => {});
      return {
        ok: true as const,
        assistantMessage,
        structured: {
          documentKind: "ledger_query",
          ledgerQuery: {
            scopeLabel: ledgerSearchAttempt.result.scopeLabel,
            txCount: ledgerSearchAttempt.result.txCount,
            totalCents: ledgerSearchAttempt.result.totalCents,
            totalsByCurrency: ledgerSearchAttempt.result.totalsByCurrency,
            displayCurrency,
            questionKind: ledgerSearchAttempt.query.questionKind,
            transactions: ledgerSearchAttempt.result.transactions,
          },
        },
        followUpQuestion: null,
        ...(ledgerSearchAttempt.plans.length > 0
          ? {
              planMatches: ledgerSearchAttempt.plans.map((plan) => ({
                planId: plan.id,
                title: plan.title,
                amountCents: plan.amountCents,
                currency: plan.currency,
              })),
            }
          : {}),
      };
    }
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

  let financeContext = await financeContextLines(prisma, userId, {
    forLookup: Boolean(message && looksLikeLedgerLookupRequest(message)),
  });
  if (files.length === 0 && message) {
    const userPrefs = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    const displayCurrency = (userPrefs?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);
    if (ledgerSearchAttempt) {
      financeContext = `${financeContext}\n\n${ledgerMatchesContextBlock({
        userMessage: message,
        query: ledgerSearchAttempt.query,
        result: ledgerSearchAttempt.result,
        displayCurrency,
      })}`;
    } else if (looksLikeLedgerLookupRequest(message)) {
      const recentBlock = await recentTransactionsContextBlock(prisma, {
        userId,
        displayCurrency,
      });
      if (recentBlock) {
        financeContext = `${financeContext}\n\n${recentBlock}`;
      }
    }
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey && !has9RouterConfig()) {
    return {
      ok: false as const,
      error:
        "Server is missing GOOGLE_GENERATIVE_AI_API_KEY or NINE_ROUTER_API_KEY. Copy .env.example to .env.local and add a key.",
    };
  }

  const modelName = adminSettings.routing.geminiModel;

  const model = apiKey
    ? new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: modelName,
        systemInstruction: buildSystemInstruction(locale, responseLanguage),
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      })
    : null;

  const prompt = buildUserPrompt({
    message,
    hasAttachments: files.length > 0,
    appLocale: locale,
    responseLanguage,
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
      const inBytes = buffer.byteLength;
      const { buffer: processed, mimeType } = await maybeCompressImageForStorage(buffer, declaredMime);
      buffer = processed;
      assertAllowedChatMime(mimeType);
      assertUploadSize(buffer.byteLength);
      preparedAttachments.push({
        buffer,
        mimeType,
        originalFilename: sanitizeOriginalFilename(file.name || "upload"),
      });
      // #region agent log
      fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
        body: JSON.stringify({
          sessionId: "51b9f5",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "chat.ts:handleChatInput:compress",
          message: "attachment processed",
          data: {
            declaredMime,
            outMime: mimeType,
            inBytes,
            outBytes: buffer.byteLength,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      parts.push({
        inlineData: {
          mimeType,
          data: buffer.toString("base64"),
        },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not process attachments.";
    // #region agent log
    fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
      body: JSON.stringify({
        sessionId: "51b9f5",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "chat.ts:handleChatInput:attachCatch",
        message: "attachment processing threw",
        data: { error: msg.slice(0, 200) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
      originChatJson?: string | null;
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
          ...(data.originChatJson != null ? { originChatJson: data.originChatJson } : {}),
        },
      });
      persistedUploads.push({ id, relativePath });
      persistedAttachmentIds.push(id);
    }
  }

  try {
    let parsed: z.SafeParseReturnType<unknown, z.infer<typeof GeminiResponseSchema>> | null = null;
    let lastModelError: unknown = null;

    const providerOrder = orderedProviders({
      preferred: resolveProviderChoice(
        adminSettings.routing.chatPrimaryProvider,
        chooseChatPrimary({
          hasAttachments: preparedAttachments.length > 0,
          message,
          hasConversationContext: Boolean(packedFinancialSummary || recentPriorTurns.length > 0),
          nineRouterAvailable: has9RouterConfig(),
        }),
      ),
      geminiAvailable: Boolean(model),
      nineRouterAvailable: has9RouterConfig(),
    });
    const routerModels = chooseChatRouterModels({
      hasAttachments: preparedAttachments.length > 0,
      message,
      hasConversationContext: Boolean(packedFinancialSummary || recentPriorTurns.length > 0),
      nineRouterAvailable: has9RouterConfig(),
      miniModel: adminSettings.routing.nineRouterMiniModel,
      largeModel: adminSettings.routing.nineRouterModel,
    });

    const executionPlan: { provider: string; modelName: string }[] = [];
    for (const provider of providerOrder) {
      if (provider === "gemini") {
        executionPlan.push({ provider, modelName });
      } else {
        for (const rm of routerModels) {
          executionPlan.push({ provider, modelName: rm });
        }
      }
    }

    for (const target of executionPlan) {
      const startedAt = Date.now();
      try {
        const selectedModel = target.modelName;
        const provider = target.provider;
        let text = "";
        let usage: AiUsageMetrics | undefined;
        if (provider === "gemini") {
          const rawText = await model!.generateContent(parts);
          text = rawText.response.text();
          usage = usageFromGeminiResult(rawText);
        } else {
          const rawText = await call9RouterChatCompletion({
            systemInstruction: buildSystemInstruction(locale, responseLanguage),
            userPrompt: prompt,
            temperature: 0.15,
            attachments: preparedAttachments,
            model: selectedModel,
            url: adminSettings.routing.nineRouterUrl,
          });
          text = rawText.text;
          usage = rawText.usage;
        }
        parsed = GeminiResponseSchema.safeParse(parseModelJson(text));
        
        let errorMessage = parsed.success ? null : "Model returned invalid JSON for chat response.";
        let success = parsed.success;
        
        if (success && parsed.data) {
          const isLastModel = target === executionPlan[executionPlan.length - 1];
          if (parsed.data.requiresComplexReasoning && !isLastModel) {
            success = false;
            errorMessage = "Model flagged requiresComplexReasoning, trying larger model.";
          } else if (preparedAttachments.length > 0 && parsed.data.documentKind === "unknown_document") {
            success = false;
            errorMessage = "Model returned unknown_document for an attachment, triggering fallback.";
          }
        }

        await recordAiRequestLog({
          userId,
          feature: "chat_response",
          provider,
          model: selectedModel,
          success,
          usage: usage || { promptTokens: null, completionTokens: null, totalTokens: null },
          latencyMs: Date.now() - startedAt,
          errorMessage,
        });

        if (success) {
          break;
        } else {
          lastModelError = new Error(errorMessage || "Unknown fallback trigger");
          parsed = null; // Clear to continue fallback
        }
      } catch (e) {
        lastModelError = e;
        await recordAiRequestLog({
          userId,
          feature: "chat_response",
          provider: target.provider,
          model: target.modelName,
          success: false,
          latencyMs: Date.now() - startedAt,
          errorMessage: e instanceof Error ? e.message : "Unknown model error.",
        });
      }
    }

    if (!parsed?.success) {
      await rollbackChatUploads();
      const messageText = lastModelError instanceof Error ? lastModelError.message : null;
      // #region agent log
      fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
        body: JSON.stringify({
          sessionId: "51b9f5",
          runId: "pre-fix",
          hypothesisId: "C",
          location: "chat.ts:handleChatInput:modelFail",
          message: "model path failed after action started",
          data: { error: (messageText || "invalid_json").slice(0, 200), attachCount: preparedAttachments.length },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return {
        ok: false as const,
        error: messageText || "The model returned invalid JSON or an unexpected format. Try again.",
      };
    }

    const data = parsed.data;
    const hadFileUpload = files.length > 0;
    const analyticsRequested =
      !hadFileUpload &&
      !looksLikeLedgerLookupRequest(message) &&
      (data.analyticsRequest != null || looksLikeAnalyticsRequest(message));

    if (analyticsRequested) {
      const analyticsWindow = resolveAnalyticsWindow(message, data.analyticsRequest?.range);
      const analyticsFocus = resolveAnalyticsFocus(message, data.analyticsRequest?.focus);
      const dashboardResult = await getLedgerDashboardAction({
        range: analyticsWindow.range,
        fromIso: analyticsWindow.fromIso,
        toIso: analyticsWindow.toIso,
        label: analyticsWindow.label,
      });
      if (!dashboardResult.ok) {
        await rollbackChatUploads();
        return {
          ok: false as const,
          error: dashboardResult.error,
        };
      }
      const { ok: _analyticsOk, ...dashboard } = dashboardResult;
      const categoryScopeCandidate = resolveAnalyticsCategoryScopeFromRows(dashboard.byCategory, message);
      const categoryScope = categoryScopeCandidate
        ? {
            categoryIds: categoryScopeCandidate.categoryIds,
            label: categoryScopeCandidate.categoryLabel ?? categoryScopeCandidate.matchedNames.join(", "),
            matchedNames: categoryScopeCandidate.matchedNames,
            expenseCents: dashboard.byCategory
              .filter((row) => row.categoryId != null && categoryScopeCandidate.categoryIds.includes(row.categoryId))
              .reduce((sum, row) => sum + row.expenseCents, 0),
          }
        : null;

      const templateMessage = buildAnalyticsAssistantMessage({
        responseLanguage,
        dashboard,
        focus: analyticsFocus,
        categoryScope,
      });
      const routerModels = chooseChatRouterModels({
        hasAttachments: false,
        message,
        hasConversationContext: recentPriorTurns.length > 0,
        nineRouterAvailable: has9RouterConfig(),
        miniModel: adminSettings.routing.nineRouterMiniModel,
        largeModel: adminSettings.routing.nineRouterModel,
      });
      const assistantMessage = has9RouterConfig()
        ? await synthesizeAnalyticsAnswer({
            userId,
            userMessage: message,
            responseLanguage,
            dashboard: {
              rangeLabel: dashboard.rangeLabel,
              displayCurrency: dashboard.displayCurrency,
              totals: dashboard.totals,
              byCategory: dashboard.byCategory.map((row) => ({
                name: row.name,
                expenseCents: row.expenseCents,
                incomeCents: row.incomeCents,
              })),
              byWallet: dashboard.byWallet.map((row) => ({
                name: row.name,
                expenseCents: row.expenseCents,
                incomeCents: row.incomeCents,
              })),
              topMerchants: dashboard.topMerchants,
              categoryScope: categoryScope
                ? {
                    label: categoryScope.label,
                    expenseCents: categoryScope.expenseCents,
                    matchedNames: categoryScope.matchedNames,
                  }
                : null,
              focus: analyticsFocus,
            },
            templateFallback: templateMessage,
            nineRouterUrl: adminSettings.routing.nineRouterUrl,
            models: routerModels,
          })
        : templateMessage;
      const followUpQuestion = analyticsNeedsClarification(message, data.analyticsRequest)
        ? analyticsClarificationQuestion(responseLanguage)
        : null;
      const structured = {
        documentKind: "analytics",
        transaction: null,
        transactionList: null,
        receipt: null,
        paystub: null,
        extractedTextSummary: null,
        awaitingLedgerDecision: false,
        analytics: {
          ...dashboard,
          focus: analyticsFocus,
          categoryScope: categoryScope
            ? {
                categoryIds: categoryScope.categoryIds,
                label: categoryScope.label,
                categories: categoryScope.matchedNames,
                expenseCents: categoryScope.expenseCents,
              }
            : null,
          fromIso: analyticsWindow.fromIso,
          toIso: analyticsWindow.toIso,
          chartMode:
            analyticsFocus === "income" ? "income" : analyticsFocus === "wallets" ? "wallets" : "categories",
          interactiveChart:
            analyticsFocus === "income"
              ? { title: "Income by category", valueKey: "incomeCents" }
              : analyticsFocus === "wallets"
                ? { title: "Outflows by wallet", valueKey: "expenseCents" }
                : { title: "Spending by category", valueKey: "expenseCents" },
        },
      };

      detectAndSaveChatPreferences(
        prisma,
        userId,
        message,
        assistantMessage,
        adminSettings.learning.enableChatPreferenceLearning,
      ).catch(() => {});

      return {
        ok: true as const,
        assistantMessage,
        structured,
        followUpQuestion,
      };
    }

    let followUpQuestion =
      typeof data.followUpQuestion === "string" && data.followUpQuestion.trim().length > 0
        ? data.followUpQuestion.trim()
        : null;

    if (hadFileUpload) {
      if (data.documentKind === "unknown_document" && !followUpQuestion) {
        followUpQuestion = languageText(
          responseLanguage,
          "I’m not sure what this file is. Is it a purchase receipt? Upload a clearer photo or type what you bought and how much.",
          "Mình chưa chắc tệp này là gì. Đây có phải hóa đơn mua hàng không? Bạn hãy tải ảnh rõ hơn hoặc gõ nhanh bạn đã mua gì và hết bao nhiêu.",
        );
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
          followUpQuestion = languageText(
            responseLanguage,
            "I couldn’t read the store or total from this receipt — can you tell me the merchant and amount, or send a clearer picture?",
            "Mình không đọc được tên cửa hàng hoặc tổng tiền trên hóa đơn này — bạn cho mình biết nơi mua và số tiền, hoặc gửi ảnh rõ hơn nhé?",
          );
        } else if (totalBad && !merchantBad && !followUpQuestion) {
          followUpQuestion = languageText(
            responseLanguage,
            "What was the total on this receipt?",
            "Tổng tiền trên hóa đơn này là bao nhiêu?",
          );
        } else if (merchantBad && !totalBad && !followUpQuestion) {
          followUpQuestion = languageText(
            responseLanguage,
            "Which store is this receipt from?",
            "Hóa đơn này là của cửa hàng nào?",
          );
        }
      }
    }

    const originChatJson = buildTransactionOriginChatJson({
      currentMessage: message,
      priorTurns: recentPriorTurns,
      attachmentNames: preparedAttachments.map((attachment) => attachment.originalFilename),
    });

    const structured = {
      documentKind: data.documentKind,
      transaction: data.transaction ?? null,
      transactionList: data.transactionList ?? null,
      receipt: data.receipt ?? null,
      paystub: data.paystub ?? null,
      extractedTextSummary: data.extractedTextSummary ?? null,
      awaitingLedgerDecision: Boolean(
        data.awaitingLedgerDecision ??
          (
            hadFileUpload &&
            (data.documentKind === "receipt" ||
              isPayrollDocumentKind(data.documentKind) ||
              data.documentKind === "transaction_list_capture")
          ),
      ),
    };

    let structuredExcerpt: string | null = null;
    try {
      structuredExcerpt = JSON.stringify({
        documentKind: data.documentKind,
        transactionPresent: Boolean(data.transaction),
        receiptPresent: Boolean(data.receipt),
        paystubPresent: Boolean(data.paystub),
        transactionListCount: Array.isArray(data.transactionList) ? data.transactionList.length : 0,
      }).slice(0, 4000);
    } catch {
      structuredExcerpt = null;
    }

    let pendingDocumentImport: PendingDocumentImport | undefined;
    let pendingLedgerEdit: PendingLedgerEdit | undefined;
    let pendingImportJson: string | null = null;

    const isFinancialUpload =
      hadFileUpload &&
      chatTurnId &&
      (data.documentKind === "receipt" ||
        isPayrollDocumentKind(data.documentKind) ||
        data.documentKind === "transaction_list_capture");

    if (isFinancialUpload) {
      let proposed =
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
      if (proposed && data.documentKind === "receipt") {
        proposed = enrichReceiptWithLineItemCategories(proposed);
      }
      const proposedItems =
        data.documentKind === "transaction_list_capture" && Array.isArray(data.transactionList)
          ? data.transactionList.filter(
              (item): item is Record<string, unknown> =>
                !!item && typeof item === "object" && !Array.isArray(item),
            )
          : [];
      if (proposed || proposedItems.length > 0) {
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
              : data.documentKind === "transaction_list_capture"
                ? "transaction_list_capture"
                : "payroll_document";
        const payload = {
          version: PENDING_IMPORT_VERSION,
          chatTurnId,
          documentKind: pendingKind,
          extractedTextSummary: extracted,
          proposed,
          ...(proposedItems.length > 0 ? { proposedItems } : {}),
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
            : proposed &&
                data.documentKind === "receipt" &&
                Array.isArray(proposed.receiptSplit) &&
                proposed.receiptSplit.length > 0
              ? proposed.receiptSplit.map((item) => {
                  const row = item as Record<string, unknown>;
                  return {
                    description: String(row.description ?? ""),
                    category: String(row.category ?? "Other"),
                    amount: Number(row.amount ?? 0),
                    currency: String(row.currency ?? "CAD"),
                    direction: row.direction === "in" ? ("in" as const) : ("out" as const),
                  };
                })
              : undefined;
        const transactionItems: TransactionImportItem[] | undefined =
          proposedItems.length > 0
            ? proposedItems.map((item) => ({
                amount: typeof item.amount === "number" ? item.amount : null,
                currency: typeof item.currency === "string" ? item.currency : null,
                merchant: typeof item.merchant === "string" ? item.merchant : null,
                category: typeof item.category === "string" ? item.category : null,
                transactionDate: typeof item.transactionDate === "string" ? item.transactionDate : null,
                notes: resolveTransactionNotes(item) ?? null,
                walletLabel: typeof item.walletLabel === "string" ? item.walletLabel : null,
                direction:
                  item.direction === "in" || item.direction === "out" ? item.direction : null,
                recurrence:
                  item.recurrence === "one_time" || item.recurrence === "recurrent" || item.recurrence === "unknown"
                    ? item.recurrence
                    : null,
                needsUserConfirm: item.needsUserConfirm === true,
                userConfirmReason:
                  typeof item.userConfirmReason === "string" ? item.userConfirmReason : null,
                payeeKind:
                  item.payeeKind === "purchase" ||
                  item.payeeKind === "bill" ||
                  item.payeeKind === "loan" ||
                  item.payeeKind === "subscription" ||
                  item.payeeKind === "utility" ||
                  item.payeeKind === "income" ||
                  item.payeeKind === "transfer"
                    ? item.payeeKind
                    : null,
              }))
            : undefined;
        pendingDocumentImport = {
          chatTurnId,
          documentKind: pendingKind,
          extractedTextSummary: extracted,
          splitItems,
          transactionItems,
        };
      }
    }

    if (pendingImportJson && preparedAttachments.length > 0) {
      await persistPreparedAttachments({
        documentKind: data.documentKind,
        structuredExcerpt,
        pendingImportJson,
        originChatJson,
      });
    }

    let assistantMessage =
      typeof data.assistantMessage === "string" && data.assistantMessage.trim().length > 0
        ? data.assistantMessage.trim()
        : languageText(
            responseLanguage,
            "I processed your upload but didn’t get a readable summary back. Try again, or add a short note about what the file is.",
            "Mình đã xử lý tệp tải lên nhưng chưa nhận được phần tóm tắt dễ đọc. Bạn thử lại hoặc ghi chú ngắn tệp này là gì nhé.",
          );
    if (pendingDocumentImport) {
      const scanInstruction =
        pendingDocumentImport.transactionItems && pendingDocumentImport.transactionItems.length > 0
          ? languageText(
              responseLanguage,
              "I found multiple transactions in the scan. Choose which ones to add using the checkboxes under the chat.",
              "Mình thấy nhiều giao dịch trong ảnh quét. Hãy chọn giao dịch muốn thêm bằng các ô chọn bên dưới khung chat.",
            )
          : languageText(
              responseLanguage,
              "Use the buttons under the chat to save this to your ledger as read, or edit details first. Edits are stored with the image for optional future training export.",
              "Dùng các nút bên dưới khung chat để lưu vào sổ chi tiêu như đã đọc, hoặc chỉnh chi tiết trước. Phần chỉnh sửa sẽ được lưu cùng ảnh để có thể xuất dữ liệu huấn luyện sau này.",
            );
      const readoutLabel = languageText(responseLanguage, "From your file (readout):", "Nội dung đọc từ tệp của bạn:");
      assistantMessage = `${assistantMessage}\n\n---\n${readoutLabel}\n${pendingDocumentImport.extractedTextSummary}\n\n---\n${scanInstruction}`;
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
          originChatJson,
        );
        if (persisted.detail) {
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
            originChatJson,
          });
        }
      } catch {
        /* ledger write is best-effort; chat reply still returns */
      }
    }

    if (
      !hadFileUpload &&
      isPayrollDocumentKind(data.documentKind) &&
      data.paystub &&
      typeof data.paystub === "object" &&
      !Array.isArray(data.paystub)
    ) {
      try {
        const rawStructuredJson = JSON.stringify({
          documentKind: data.documentKind,
          paystub: data.paystub,
        });
        const persisted = await persistPaystubLedgerEntry(
          prisma,
          userId,
          data.paystub as Record<string, unknown>,
          rawStructuredJson,
          originChatJson,
        );
        if (persisted.detail) {
          assistantMessage = `${assistantMessage}\n\n${persisted.detail}`;
        }
      } catch {
        /* ledger write is best-effort; chat reply still returns */
      }
    }

    if (
      data.documentKind === "ledger_edit" &&
      data.ledgerEdit &&
      typeof data.ledgerEdit === "object"
    ) {
      try {
        const edit = data.ledgerEdit;
        const editPayload = {
          merchantHint: edit.merchantHint ?? null,
          dateHint: edit.dateHint ?? null,
          walletHint: edit.walletHint ?? null,
          categoryHint: edit.categoryHint ?? null,
          memoHint: edit.memoHint ?? null,
          newAmount: typeof edit.newAmount === "number" ? edit.newAmount : null,
          newMemo: edit.newMemo ?? null,
          newCategory: edit.newCategory ?? null,
          newMerchant: typeof edit.newMerchant === "string" ? edit.newMerchant : null,
        };
        const preview = await previewLedgerEdit(prisma, userId, editPayload);
        if (preview.found && preview.matchedCount > 1) {
          pendingLedgerEdit = {
            ...editPayload,
            matchedCount: preview.matchedCount,
            scopeLabel:
              editPayload.merchantHint?.trim() ||
              editPayload.walletHint?.trim() ||
              editPayload.categoryHint?.trim() ||
              editPayload.memoHint?.trim() ||
              editPayload.dateHint?.trim() ||
              "matching transactions",
          };
          assistantMessage = languageText(
            responseLanguage,
            `I found ${preview.matchedCount} matching transactions for ${pendingLedgerEdit.scopeLabel}. Please click Proceed in the chat window to apply this bulk edit.`,
            `Mình tìm thấy ${preview.matchedCount} giao dịch khớp với ${pendingLedgerEdit.scopeLabel}. Hãy bấm Tiếp tục trong khung chat để áp dụng chỉnh sửa hàng loạt này.`,
          );
        } else {
          const result = await applyLedgerEdit(prisma, userId, editPayload);
          if (!result.saved && /couldn't find any matching transactions to edit/i.test(result.detail)) {
            assistantMessage = languageText(
              responseLanguage,
              "I couldn't find a matching transaction to edit. Give me the merchant, date, wallet, or category and I’ll try again.",
              "Mình không tìm thấy giao dịch phù hợp để sửa. Bạn cho mình thêm merchant, ngày, ví, hoặc danh mục để mình thử lại nhé.",
            );
            followUpQuestion = languageText(
              responseLanguage,
              "Which transaction should I edit? Give me the merchant, date, wallet, or category.",
              "Mình cần sửa giao dịch nào? Bạn cho mình merchant, ngày, ví, hoặc danh mục nhé.",
            );
          } else {
            assistantMessage = `${assistantMessage}\n\n${result.detail}`;
          }
        }
      } catch {
        /* best-effort */
      }
    }

    let planCreated = false;
    let createdPlan: { planId: string; title: string; amountCents: number | null; currency: string } | null = null;
    if (
      data.planSuggestion &&
      typeof data.planSuggestion === "object" &&
      data.planSuggestion.title?.trim()
    ) {
      const ps = data.planSuggestion;
      try {
        const applied = await applyPlanSuggestion(prisma, userId, message, {
          title: ps.title,
          description: ps.description ?? null,
          amountCents: ps.amountCents ?? null,
          currency: ps.currency ?? null,
          period: ps.period ?? null,
          targetDate: ps.targetDate ?? null,
        });
        if (applied.outcome === "plan") {
          planCreated = true;
          createdPlan = {
            planId: applied.planId,
            title: applied.title,
            amountCents: applied.amountCents,
            currency: applied.currency,
          };
        } else if (applied.outcome === "draft" && applied.detail) {
          assistantMessage = `${assistantMessage}\n\n${applied.detail}`;
        } else if (applied.outcome === "follow_up") {
          followUpQuestion = applied.followUpQuestion;
          if (/\b(saved|added)\b/i.test(assistantMessage)) {
            assistantMessage = "I didn't save a plan or a transaction yet.";
          }
        } else if (applied.outcome === "error") {
          assistantMessage = `${assistantMessage}\n\n${applied.error}`;
        }
      } catch {
        /* best-effort — chat reply still returns */
      }
    }

    let pendingRecurrenceApplied: null | { label: string; cadenceText: string } = null;
    if (
      data.pendingRecurrenceUpdate &&
      typeof data.pendingRecurrenceUpdate.cadenceText === "string" &&
      data.pendingRecurrenceUpdate.cadenceText.trim()
    ) {
      try {
        const hint = (data.pendingRecurrenceUpdate.merchantHint ?? "").trim().toLowerCase();
        const pending = await prisma.transaction.findMany({
          where: { userId, status: "pending_user" },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, merchant: true, memo: true },
        });
        const match =
          (hint &&
            pending.find(
              (p) =>
                (p.merchant ?? "").toLowerCase().includes(hint) ||
                (p.memo ?? "").toLowerCase().includes(hint),
            )) ||
          pending[0] ||
          null;
        if (match) {
          const { applyPendingRecurrenceFromTextAction } = await import("@/actions/finance");
          const r = await applyPendingRecurrenceFromTextAction({
            pendingTransactionId: match.id,
            text: data.pendingRecurrenceUpdate.cadenceText,
            nextReminderAt: data.pendingRecurrenceUpdate.nextReminderAt ?? null,
          });
          if (r.ok) {
            pendingRecurrenceApplied = {
              label: match.merchant ?? match.memo ?? "pending item",
              cadenceText: data.pendingRecurrenceUpdate.cadenceText.trim(),
            };
            assistantMessage = `${assistantMessage}\n\n${languageText(
              responseLanguage,
              `Got it — set "${pendingRecurrenceApplied.label}" to ${pendingRecurrenceApplied.cadenceText}.`,
              `Đã hiểu — mình đặt "${pendingRecurrenceApplied.label}" thành ${pendingRecurrenceApplied.cadenceText}.`,
            )}`;
          } else if (/clear cadence|one-time|weekly|monthly|yearly|every/i.test(r.error)) {
            assistantMessage = languageText(
              responseLanguage,
              "I need a clearer cadence before I can apply that recurring change. Please reply with one-time, weekly, monthly, yearly, or every 2 weeks.",
              "Mình cần một nhịp lặp rõ hơn để áp dụng. Bạn hãy trả lời kiểu one-time, weekly, monthly, yearly, hoặc every 2 weeks nhé.",
            );
          }
        }
      } catch {
        /* best-effort — chat reply still returns */
      }
    }

    // Best-effort chat style learning — never blocks response
    detectAndSaveChatPreferences(
      prisma,
      userId,
      message,
      assistantMessage,
      adminSettings.learning.enableChatPreferenceLearning,
    ).catch(() => {});

    return {
      ok: true as const,
      assistantMessage,
      structured,
      followUpQuestion,
      ...(pendingDocumentImport ? { pendingDocumentImport } : {}),
      ...(pendingLedgerEdit ? { pendingLedgerEdit } : {}),
      ...(planCreated && createdPlan
        ? { planCreated: true as const, planId: createdPlan.planId, planNotice: createdPlan }
        : {}),
      ...(pendingRecurrenceApplied ? { pendingRecurrenceApplied } : {}),
    };
  } catch (error) {
    await rollbackChatUploads();
    const messageText =
      error instanceof Error ? error.message : "Unknown error calling Gemini.";
    // #region agent log
    fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
      body: JSON.stringify({
        sessionId: "51b9f5",
        runId: "pre-fix",
        hypothesisId: "C-D",
        location: "chat.ts:handleChatInput:catch",
        message: "uncaught chat action error",
        data: { error: messageText.slice(0, 200) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return {
      ok: false as const,
      error: messageText,
    };
  }
}
