"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { auth } from "@/auth";
import type { ConversationTurnForApi } from "@/lib/chat/conversation-context";

const PackResponseSchema = z.object({
  financialSummary: z.string(),
});

const PACK_SYSTEM = `You consolidate chat transcripts into FINANCIAL FACTS ONLY for a personal bookkeeping assistant.

Output JSON only (no markdown fences) with this exact shape:
{ "financialSummary": string }

Rules for financialSummary:
- Plain text, bullet-style or short paragraphs OK; no JSON inside the string except when quoting amounts/merchants.
- Include: purchases, income, transfers, merchants, amounts, currencies, categories mentioned, dates, recurring/subscription hints, paystub/receipt outcomes, open confirmations, corrections the user made.
- Exclude: greetings, jokes, thanks, how-to about the app unless it changes a financial rule the user stated.
- If there is nothing financial in the segment, return a single sentence like "No additional financial facts in this segment."
- When a PRIOR SUMMARY is provided, merge it with the NEW SEGMENT: dedupe, update if the user corrected an earlier figure, keep the result under about 4000 characters if possible by dropping stale minor details.`;

function formatSegment(turns: ConversationTurnForApi[]): string {
  const lines: string[] = [];
  for (const t of turns) {
    const tag = t.role === "user" ? "User" : "Assistant";
    lines.push(`${tag}: ${t.content}`);
    if (t.extractionNote) {
      lines.push(`(Assistant extraction excerpt): ${t.extractionNote}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export type PackFinancialConversationResult =
  | { ok: true; financialSummary: string }
  | { ok: false; error: string };

/**
 * Merges prior packed financial context with newly aged-out chat turns.
 */
export async function packFinancialConversationAction(input: {
  priorSummary: string | null;
  segment: ConversationTurnForApi[];
}): Promise<PackFinancialConversationResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sign in to continue." };
  }

  if (input.segment.length === 0) {
    return { ok: true, financialSummary: (input.priorSummary ?? "").trim() || "No prior context." };
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Server is missing GOOGLE_GENERATIVE_AI_API_KEY. Copy .env.example to .env.local and add your key.",
    };
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: PACK_SYSTEM,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const prior = (input.priorSummary ?? "").trim();
  const segmentText = formatSegment(input.segment);
  const userPrompt =
    prior.length > 0
      ? `PRIOR SUMMARY (financial facts only, may be empty):\n${prior}\n\nNEW SEGMENT TO MERGE:\n${segmentText}\n\nReturn ONLY valid JSON with "financialSummary".`
      : `NEW SEGMENT TO SUMMARIZE (financial facts only):\n${segmentText}\n\nReturn ONLY valid JSON with "financialSummary".`;

  try {
    const result = await model.generateContent(userPrompt);
    const rawText = result.response.text();
    let json: unknown;
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      return { ok: false, error: "Packing model returned invalid JSON. Try sending again." };
    }
    const parsed = PackResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Packing model returned an unexpected format." };
    }
    return { ok: true, financialSummary: parsed.data.financialSummary.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error while packing conversation.";
    return { ok: false, error: msg };
  }
}
