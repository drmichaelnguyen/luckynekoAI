import { GoogleGenerativeAI } from "@google/generative-ai";

import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { recordAiRequestLog, usageFromGeminiResult } from "@/lib/ai/telemetry";

const FEATURE = "ledger_search_keywords";

const SYSTEM_INSTRUCTION = `You turn a user's question about their personal spending ledger into short search keywords that would appear on matching transactions (merchant names, brands, product types, memo words).

Rules:
- Output 4 to 16 keywords, one per line. No numbering, bullets, quotes, or explanation.
- Prefer concrete ledger text: store brands, product types, software names, service names — not grammar words.
- Expand abstract topics into likely merchants/products. Examples:
  - photography → photography, photo, camera, lens, nikon, canon, sony, adobe, lightroom, photoshop, studio, tripod
  - coffee → coffee, cafe, starbucks, tim hortons, espresso
  - gas → gas, fuel, shell, esso, petro
- Keep person names, shop names, vehicle models, and holiday names from the question exactly as written.
- Include the original topic word when it is useful as a keyword.
- Do not invent amounts, dates, or categories. Keywords only.
- English keywords even if the question is Vietnamese (keep proper nouns as written).`;

function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKeywordLines(raw: string): string[] {
  const stop = new Set([
    "how",
    "much",
    "did",
    "spend",
    "spent",
    "spending",
    "for",
    "on",
    "the",
    "a",
    "an",
    "my",
    "i",
    "and",
    "or",
    "to",
    "of",
    "in",
    "at",
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[\s*•\-–—\d.)]+/, "")
      .replace(/["'`]/g, "")
      .trim();
    if (!cleaned || cleaned.length > 40) continue;
    // Allow "capture one" / "tim hortons" style phrases (max 3 tokens).
    const parts = cleaned.split(/[,|;]+/).map((part) => part.trim());
    for (const part of parts) {
      const normalized = normalizeKeyword(part);
      if (!normalized || normalized.length < 2) continue;
      if (stop.has(normalized)) continue;
      if (normalized.split(" ").length > 3) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= 16) return out;
    }
  }
  return out;
}

/**
 * Ask the model for merchant/memo keywords that would match the user's question.
 * Used when a literal ledger keyword search returns no rows.
 */
export async function expandLedgerSearchKeywords(input: {
  message: string;
  userId?: string;
  geminiModel: string;
  nineRouterUrl?: string;
  nineRouterModel?: string;
}): Promise<string[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey) {
    const startedAt = Date.now();
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: input.geminiModel,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0 },
      });
      const result = await model.generateContent(
        `User question:\n${input.message}\n\nSearch keywords:`,
      );
      const keywords = parseKeywordLines(result.response.text());
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "gemini",
        model: input.geminiModel,
        success: keywords.length > 0,
        usage: usageFromGeminiResult(result),
        latencyMs: Date.now() - startedAt,
        errorMessage: keywords.length > 0 ? null : "Empty keyword list.",
      });
      if (keywords.length > 0) return keywords;
    } catch (err) {
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "gemini",
        model: input.geminiModel,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : "Keyword expansion failed.",
      });
    }
  }

  if (has9RouterConfig()) {
    const startedAt = Date.now();
    const model = input.nineRouterModel ?? "gpt-5";
    try {
      const res = await call9RouterChatCompletion({
        systemInstruction: SYSTEM_INSTRUCTION,
        userPrompt: `User question:\n${input.message}\n\nSearch keywords:`,
        temperature: 0,
        model,
        url: input.nineRouterUrl,
      });
      const keywords = parseKeywordLines(res.text);
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "9router",
        model,
        success: keywords.length > 0,
        usage: res.usage,
        latencyMs: Date.now() - startedAt,
        errorMessage: keywords.length > 0 ? null : "Empty keyword list.",
      });
      if (keywords.length > 0) return keywords;
    } catch (err) {
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "9router",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : "Keyword expansion failed.",
      });
    }
  }

  return [];
}
