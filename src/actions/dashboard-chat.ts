"use server";

import { auth } from "@/auth";
import { synthesizeLedgerAnswer } from "@/lib/ai/data-answer";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { chooseChatRouterModels } from "@/lib/ai/model-router";
import { loadAdminRuntimeSettings } from "@/lib/admin-runtime-settings";
import { parseLedgerQuery, searchLedger } from "@/lib/finance/ledger-query";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type DashboardChatHistory = { role: "user" | "assistant"; content: string }[];

export async function dashboardMiniChatAction(
  message: string,
  history: DashboardChatHistory,
  dashboardData: any
): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferredCurrency: true },
    });
    const displayCurrency = (user?.preferredCurrency ?? dashboardData?.displayCurrency ?? "CAD").toUpperCase().slice(0, 3);
    const adminSettings = await loadAdminRuntimeSettings();
    const routerModels = chooseChatRouterModels({
      hasAttachments: false,
      message,
      hasConversationContext: history.length > 0,
      nineRouterAvailable: has9RouterConfig(),
      miniModel: adminSettings.routing.nineRouterMiniModel,
      largeModel: adminSettings.routing.nineRouterModel,
    });

    const ledgerSearch = await searchLedger(prisma, {
      userId: session.user.id,
      message,
      displayCurrency,
    });
    if (ledgerSearch && !ledgerSearch.formattedText.includes("couldn't find")) {
      const response = has9RouterConfig()
        ? await synthesizeLedgerAnswer({
            userId: session.user.id,
            userMessage: message,
            responseLanguage: "English",
            displayCurrency,
            query: ledgerSearch.query,
            result: ledgerSearch.result,
            templateFallback: ledgerSearch.formattedText,
            nineRouterUrl: adminSettings.routing.nineRouterUrl,
            models: routerModels,
          })
        : ledgerSearch.formattedText;
      return { ok: true, response };
    }

    if (!has9RouterConfig()) {
      return { ok: false, error: "AI routing is not configured." };
    }

    const dashboardFrom = typeof dashboardData?.fromIso === "string" ? new Date(dashboardData.fromIso) : null;
    const recentWhere: Prisma.TransactionWhereInput = {
      userId: session.user.id,
      status: { not: "rejected" },
      currency: displayCurrency,
      ...(dashboardFrom && !Number.isNaN(dashboardFrom.getTime()) ? { occurredAt: { gte: dashboardFrom } } : {}),
    };
    const recentTransactions = await prisma.transaction.findMany({
      where: recentWhere,
      orderBy: { occurredAt: "desc" },
      take: 60,
      include: { wallet: true, category: { include: { parent: true } } },
    });

    // Sanitize the dashboard data (bounded summaries + recent rows only)
    const context = {
      range: dashboardData.rangeLabel,
      currency: dashboardData.displayCurrency,
      totals: dashboardData.totals,
      topMerchants: dashboardData.topMerchants,
      byWallet: dashboardData.byWallet,
      byCategory: dashboardData.byCategory.map((c: any) => ({
        name: c.name,
        expenseCents: c.expenseCents,
        incomeCents: c.incomeCents,
      })),
      recentTransactions: recentTransactions.map((tx) => ({
        date: tx.occurredAt.toISOString().slice(0, 10),
        direction: tx.direction,
        amountCents: tx.amountCents,
        merchant: tx.merchant,
        memo: tx.memo,
        wallet: tx.wallet.name,
        category: tx.category?.parent?.name
          ? `${tx.category.parent.name} > ${tx.category.name}`
          : tx.category?.name ?? "Uncategorized",
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
- If the user asks about something not in the data context, say exactly what is missing instead of guessing.
- Use recentTransactions for concrete examples, but say when the answer is based only on the current dashboard range and the 60 most recent rows.
- Respect wallet names and category names exactly. Do not confuse a wallet with a category or merchant.
- Reply in the same language as the user's latest message.
- You can offer short insights like "You spent the most on..." if they ask for a summary.`;

    const conversation = history.length > 0
      ? "Previous conversation:\n" + history.map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n") + "\n\n"
      : "";

    const userPrompt = `${conversation}User: ${message}`;

    const modelsToTry = routerModels;

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
  } catch (err) {
    console.error("dashboardMiniChatAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Re-export for tests or callers that need to inspect parsing without executing a query.
export { parseLedgerQuery };
