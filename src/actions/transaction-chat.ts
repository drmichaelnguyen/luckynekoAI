"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { chooseChatRouterModels, parseModelJson } from "@/lib/ai/model-router";
import { z } from "zod";

export type TransactionChatHistory = { role: "user" | "assistant"; content: string }[];

const ResponseSchema = z.object({
  assistantMessage: z.string(),
  proposedEdit: z.object({
    amountCents: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    direction: z.enum(["in", "out"]).nullable().optional(),
    merchant: z.string().nullable().optional(),
    memo: z.string().nullable().optional(),
    dateHint: z.string().nullable().optional(),
  }).nullable().optional(),
  requiresComplexReasoning: z.boolean().optional(),
});

export type TransactionChatResult = 
  | { ok: true; response: z.infer<typeof ResponseSchema> }
  | { ok: false; error: string };

export async function transactionMiniChatAction(
  transactionId: string,
  message: string,
  history: TransactionChatHistory
): Promise<TransactionChatResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId: session.user.id },
    include: { category: true, wallet: true },
  });

  if (!tx) return { ok: false, error: "Transaction not found." };

  if (!has9RouterConfig()) {
    return { ok: false, error: "AI routing is not configured." };
  }

  const txContext = {
    amountCents: tx.amountCents,
    currency: tx.currency,
    direction: tx.direction,
    merchant: tx.merchant,
    memo: tx.memo,
    occurredAt: tx.occurredAt.toISOString(),
    status: tx.status,
    source: tx.source,
    categoryName: tx.category?.name ?? "Other",
    walletName: tx.wallet.name,
    rawExtraction: tx.rawStructuredJson ? JSON.parse(tx.rawStructuredJson) : null,
  };

  const systemInstruction = `You are an AI assistant helping a user review a specific financial transaction.
You must return a raw JSON object (and ONLY JSON, no markdown formatting) conforming exactly to this schema:
{
  "assistantMessage": "Your reply to the user",
  "proposedEdit": {
    "amountCents": number or null,
    "currency": "CAD" or "USD" or null,
    "direction": "in" or "out" or null,
    "merchant": string or null,
    "memo": string or null,
    "dateHint": string or null
  } | null,
  "requiresComplexReasoning": boolean
}

Transaction Details:
${JSON.stringify(txContext, null, 2)}

If the user asks a question, answer it. If the user asks you to modify the transaction (e.g. "change merchant to Starbucks", "this was $15"), propose those changes in the \`proposedEdit\` object. Do NOT edit unless explicitly asked or strongly implied.
If you are confused by the request and need a larger model, set \`requiresComplexReasoning: true\`.`;

  const conversation = history.length > 0 
    ? "Previous conversation:\n" + history.map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n") + "\n\n"
    : "";

  const userPrompt = `${conversation}User: ${message}`;

  const modelsToTry = chooseChatRouterModels({
    hasAttachments: false,
    message: message,
    hasConversationContext: history.length > 0,
    nineRouterAvailable: true,
  });

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      const res = await call9RouterChatCompletion({
        systemInstruction,
        userPrompt,
        model,
        temperature: 0.1,
      });

      const parsed = ResponseSchema.parse(parseModelJson(res.text));
      
      if (parsed.requiresComplexReasoning && modelsToTry.length > 1 && model === modelsToTry[0]) {
        console.log(`Model ${model} requested complex reasoning fallback for mini-chat.`);
        continue; // Fallback to next model
      }
      
      return { ok: true, response: parsed };
    } catch (err: any) {
      console.warn(`transactionMiniChatAction error with model ${model}:`, err);
      lastError = err;
      // Fallback on JSON parse error
    }
  }

  return { ok: false, error: lastError?.message || "AI failed to respond." };
}

