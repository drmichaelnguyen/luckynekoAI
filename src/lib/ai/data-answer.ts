import { call9RouterChatCompletion } from "@/lib/ai/9router";
import { chooseChatRouterModels } from "@/lib/ai/model-router";
import { recordAiRequestLog } from "@/lib/ai/telemetry";
import type {
  LedgerQueryResult,
  LedgerSearchRow,
  ParsedLedgerQuery,
} from "@/lib/finance/ledger-query";

type ResponseLanguage = "English" | "Vietnamese";

export type AnalyticsContextPayload = {
  rangeLabel: string;
  displayCurrency: string;
  totals: {
    expenseCents: number;
    incomeCents: number;
    netCents: number;
    transactionCount: number;
  };
  byCategory: Array<{ name: string; expenseCents: number; incomeCents: number }>;
  byWallet: Array<{ name: string; expenseCents: number; incomeCents: number }>;
  topMerchants: Array<{ label: string; expenseCents: number }>;
  recentTransactions?: Array<{
    date: string;
    direction: string;
    amountCents: number;
    merchant: string | null;
    memo: string | null;
    wallet: string;
    category: string;
  }>;
  categoryScope?: { label: string; expenseCents: number; matchedNames: string[] } | null;
  focus?: string;
};

function formatTxForModel(tx: LedgerSearchRow, displayCurrency: string) {
  return {
    date: tx.occurredAt.slice(0, 10),
    direction: tx.direction,
    amount: `${displayCurrency} ${(tx.amountCents / 100).toFixed(2)}`,
    amountCents: tx.amountCents,
    currency: tx.currency,
    merchant: tx.merchant,
    memo: tx.memo,
    wallet: tx.walletName,
    category: tx.categoryName,
    matchScore: tx.matchScore,
  };
}

function dedupeTransactions(transactions: LedgerSearchRow[]): LedgerSearchRow[] {
  const seen = new Set<string>();
  const out: LedgerSearchRow[] = [];
  for (const tx of transactions) {
    const key = [
      tx.occurredAt.slice(0, 10),
      tx.amountCents,
      (tx.merchant ?? "").toLowerCase().trim(),
      (tx.memo ?? "").toLowerCase().trim().slice(0, 80),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
  }
  return out;
}

export function ledgerMatchesContextBlock(input: {
  userMessage: string;
  query: ParsedLedgerQuery;
  result: LedgerQueryResult;
  displayCurrency: string;
}): string {
  const rows = dedupeTransactions(input.result.transactions).slice(0, 40);
  if (rows.length === 0) {
    return [
      "LEDGER SEARCH (no matches for the user's question):",
      `Question: ${input.userMessage}`,
      `Scope tried: ${input.result.scopeLabel}`,
      "Tell the user nothing matched and suggest a clearer memo, merchant, or date range.",
    ].join("\n");
  }

  return [
    "LEDGER SEARCH RESULTS (authoritative — only cite rows listed here):",
    `User question: ${input.userMessage}`,
    `Search scope: ${input.result.scopeLabel}`,
    `Match count: ${input.result.txCount} (${rows.length} unique rows shown)`,
    JSON.stringify(rows.map((tx) => formatTxForModel(tx, input.displayCurrency)), null, 2),
  ].join("\n");
}

async function runDataAnswerCompletion(input: {
  feature: string;
  userId?: string;
  systemInstruction: string;
  userPrompt: string;
  nineRouterUrl?: string;
  models?: string[];
  temperature?: number;
}): Promise<string | null> {
  const models = chooseChatRouterModels({
    hasAttachments: false,
    message: input.userPrompt,
    hasConversationContext: false,
    nineRouterAvailable: true,
    miniModel: input.models?.[0],
    largeModel: input.models?.[1] ?? input.models?.[0],
  });

  let lastError: Error | null = null;
  for (const model of models) {
    const startedAt = Date.now();
    try {
      const res = await call9RouterChatCompletion({
        systemInstruction: input.systemInstruction,
        userPrompt: input.userPrompt,
        model,
        temperature: input.temperature ?? 0.25,
        url: input.nineRouterUrl,
      });
      const text = res.text.trim();
      if (!text) throw new Error("Empty model response.");

      await recordAiRequestLog({
        userId: input.userId,
        feature: input.feature,
        provider: "9router",
        model,
        success: true,
        usage: res.usage ?? { promptTokens: null, completionTokens: null, totalTokens: null },
        latencyMs: Date.now() - startedAt,
        errorMessage: null,
      });
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Model call failed.");
      await recordAiRequestLog({
        userId: input.userId,
        feature: input.feature,
        provider: "9router",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: lastError.message,
      });
    }
  }

  if (lastError) console.warn(`${input.feature} synthesis failed:`, lastError.message);
  return null;
}

export async function synthesizeLedgerAnswer(input: {
  userId?: string;
  userMessage: string;
  responseLanguage: ResponseLanguage;
  displayCurrency: string;
  query: ParsedLedgerQuery;
  result: LedgerQueryResult;
  templateFallback: string;
  nineRouterUrl?: string;
  models?: string[];
}): Promise<string> {
  const rows = dedupeTransactions(input.result.transactions);
  const context = ledgerMatchesContextBlock({
    userMessage: input.userMessage,
    query: input.query,
    result: { ...input.result, transactions: rows },
    displayCurrency: input.displayCurrency,
  });

  const systemInstruction = `You are NekoZeni, a sharp personal finance assistant with direct access to the user's ledger search results.
Answer the user's question using ONLY the LEDGER SEARCH RESULTS provided. Do not invent merchants, dates, amounts, or mileage.

Guidelines:
- Reply in ${input.responseLanguage}.
- Be specific: cite exact dates, amounts, merchants, and memo details from the rows.
- When the user asks "when", give the most recent relevant date first and mention older ones if useful.
- When they ask about mileage/odometer, extract it from memo text if present; say clearly when it was not recorded.
- Distinguish similar services (e.g. engine oil & filter vs differential oil change) — do not conflate them.
- Near-duplicate rows (same date/amount/memo) are logging duplicates — mention the event once.
- For "how much" questions, sum only the rows that truly match the question scope.
- Keep answers concise and conversational (2-5 sentences unless they asked for a list).
- If nothing matches, say so and suggest how they could log it next time (memo with vehicle + service + odometer).
- Do not mention JSON, search algorithms, or that you are an AI.`;

  const userPrompt = `${context}\n\nUser question: ${input.userMessage}`;

  const synthesized = await runDataAnswerCompletion({
    feature: "ledger_answer_synthesis",
    userId: input.userId,
    systemInstruction,
    userPrompt,
    nineRouterUrl: input.nineRouterUrl,
    models: input.models,
    temperature: 0.2,
  });

  return synthesized ?? input.templateFallback;
}

export async function synthesizeAnalyticsAnswer(input: {
  userId?: string;
  userMessage: string;
  responseLanguage: ResponseLanguage;
  dashboard: AnalyticsContextPayload;
  templateFallback: string;
  nineRouterUrl?: string;
  models?: string[];
}): Promise<string> {
  const context = JSON.stringify(input.dashboard, null, 2);

  const systemInstruction = `You are NekoZeni, a helpful financial analyst. The user asked about their spending/income analytics.
Use ONLY the dashboard data below. All amounts are in CENTS — divide by 100 for dollar amounts and format with ${input.dashboard.displayCurrency}.

Guidelines:
- Reply in ${input.responseLanguage}.
- Lead with the direct answer to their question, then add 1-2 useful insights (top category, wallet, merchant, trend).
- Mention the time range (${input.dashboard.rangeLabel}) so they know what window you are describing.
- If categoryScope is set, make clear you are filtering to those categories.
- Point them to the interactive chart below when relevant.
- Be concise (2-4 sentences) unless they asked for a detailed breakdown.
- Do not invent transactions or categories not in the data.`;

  const userPrompt = `Dashboard data:\n${context}\n\nUser question: ${input.userMessage}`;

  const synthesized = await runDataAnswerCompletion({
    feature: "analytics_answer_synthesis",
    userId: input.userId,
    systemInstruction,
    userPrompt,
    nineRouterUrl: input.nineRouterUrl,
    models: input.models,
    temperature: 0.3,
  });

  return synthesized ?? input.templateFallback;
}
