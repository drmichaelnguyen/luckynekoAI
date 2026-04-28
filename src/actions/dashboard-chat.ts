"use server";

import { auth } from "@/auth";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { chooseChatRouterModels } from "@/lib/ai/model-router";

export type DashboardChatHistory = { role: "user" | "assistant"; content: string }[];

export async function dashboardMiniChatAction(
  message: string,
  history: DashboardChatHistory,
  dashboardData: any
): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  if (!has9RouterConfig()) {
    return { ok: false, error: "AI routing is not configured." };
  }

  // Sanitize the dashboard data (do not send huge lists, just summaries)
  const context = {
    range: dashboardData.rangeLabel,
    currency: dashboardData.displayCurrency,
    totals: dashboardData.totals,
    topMerchants: dashboardData.topMerchants,
    byCategory: dashboardData.byCategory.map((c: any) => ({
      name: c.name,
      expenseCents: c.expenseCents,
      incomeCents: c.incomeCents,
    })),
  };

  const systemInstruction = `You are a helpful AI financial analyst assisting a user with their NekoZeni dashboard.
You are given the user's aggregated financial data for a specific time range.
Use this data to answer their questions accurately and concisely.

Data Context:
${JSON.stringify(context, null, 2)}

Rules:
- Keep answers short and friendly.
- Format currency amounts properly (e.g. $5.00 instead of 500 cents). Note that all amounts in the context are in CENTS (1/100 of the currency unit). You must divide by 100.
- If the user asks about something not in the data context, let them know you don't have that specific data in this view.
- You can offer short insights like "You spent the most on..." if they ask for a summary.`;

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
        temperature: 0.3,
      });

      return { ok: true, response: res.text };
    } catch (err: any) {
      console.warn(`dashboardMiniChatAction error with model ${model}:`, err);
      lastError = err;
    }
  }

  return { ok: false, error: lastError?.message || "AI failed to respond." };
}
