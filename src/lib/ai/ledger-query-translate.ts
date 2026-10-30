import { GoogleGenerativeAI } from "@google/generative-ai";

import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { recordAiRequestLog, usageFromGeminiResult } from "@/lib/ai/telemetry";
import { detectLanguageFromMessage } from "@/lib/learning/chat-preferences";

const FEATURE = "ledger_query_translation";

const SYSTEM_INSTRUCTION = `You translate a Vietnamese (or mixed Vietnamese/English) question about the user's own saved money transactions into ONE short English question for a keyword ledger search.

Rules:
- Output only the English question. No quotes, labels, or explanation.
- Keep person names, merchant names, shop names, place names, brand names, vehicle models, holiday names (e.g. Tết), numbers, amounts, and dates exactly as written, including Vietnamese spelling.
- Use plain English bookkeeping words for everything else, for example: xăng / đổ xăng → gas; thay nhớt / thay dầu → oil change; tiền nhà / thuê nhà → rent; tiền điện → electricity; tiền nước → water bill; siêu thị / đi chợ → groceries; ăn uống / ăn ngoài / nhà hàng → dining; cà phê → coffee; bảo hiểm → insurance; sửa xe → car repair; lương → salary; nhận tiền / thu nhập → income.
- Translate time phrases: hôm nay → today; hôm qua → yesterday; tuần này → this week; tháng này → this month; tháng trước → last month; năm nay → this year; năm ngoái / năm trước → last year; 30 ngày qua → last 30 days; tháng 3 năm 2026 → March 2026.
- Keep the question shape: bao nhiêu → "how much"; khi nào / lần cuối → "when did I" / "last time I"; tìm / xem / liệt kê → "find" / "show".
- Do not add details that are not in the question.`;

function cleanTranslation(raw: string): string | null {
  const line = raw
    .trim()
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return null;
  const text = line.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!text || text.length > 400) return null;
  return text;
}

/**
 * The rule-based ledger parser only understands English keywords and time phrases,
 * so Vietnamese Ask-mode questions are rewritten to English before searching.
 * Returns null when the message is not Vietnamese or every model call fails.
 */
export async function translateLedgerQuestionToEnglish(input: {
  message: string;
  userId?: string;
  geminiModel: string;
  nineRouterUrl?: string;
  nineRouterModel?: string;
}): Promise<string | null> {
  if (detectLanguageFromMessage(input.message) !== "vi") return null;

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey) {
    const startedAt = Date.now();
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: input.geminiModel,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0 },
      });
      const result = await model.generateContent(input.message);
      const text = cleanTranslation(result.response.text());
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "gemini",
        model: input.geminiModel,
        success: Boolean(text),
        usage: usageFromGeminiResult(result),
        latencyMs: Date.now() - startedAt,
        errorMessage: text ? null : "Empty translation.",
      });
      if (text) return text;
    } catch (err) {
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "gemini",
        model: input.geminiModel,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : "Translation failed.",
      });
    }
  }

  if (has9RouterConfig()) {
    const startedAt = Date.now();
    const model = input.nineRouterModel ?? "gpt-5";
    try {
      const res = await call9RouterChatCompletion({
        systemInstruction: SYSTEM_INSTRUCTION,
        userPrompt: input.message,
        temperature: 0,
        model,
        url: input.nineRouterUrl,
      });
      const text = cleanTranslation(res.text);
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "9router",
        model,
        success: Boolean(text),
        usage: res.usage,
        latencyMs: Date.now() - startedAt,
        errorMessage: text ? null : "Empty translation.",
      });
      if (text) return text;
    } catch (err) {
      await recordAiRequestLog({
        userId: input.userId,
        feature: FEATURE,
        provider: "9router",
        model,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : "Translation failed.",
      });
    }
  }

  return null;
}
