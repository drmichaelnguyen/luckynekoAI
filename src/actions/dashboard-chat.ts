"use server";

import { auth } from "@/auth";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import { chooseChatRouterModels } from "@/lib/ai/model-router";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type DashboardChatHistory = { role: "user" | "assistant"; content: string }[];

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parent: { id: string; name: string; slug: string } | null;
};

type ParsedSpendQuery = {
  timeRange: { from: Date; to: Date; label: string } | null;
  categoryIds: string[];
  categoryLabel: string | null;
  walletIds: string[];
  walletLabel: string | null;
  searchTerms: string[];
  direction: "out" | "in";
};

type WalletRow = {
  id: string;
  name: string;
};

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(cents: number, currency: string): string {
  const abs = Math.abs(cents) / 100;
  return `${currency} ${abs.toFixed(2)}`;
}

function startOfUtcYear(year: number): Date {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
}

function endOfUtcYear(year: number): Date {
  return new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
}

function addUtcMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function parseTimeRange(message: string): { from: Date; to: Date; label: string } | null {
  const normalized = normalizeQueryText(message);
  if (!normalized) return null;

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      from: startOfUtcYear(year),
      to: endOfUtcYear(year),
      label: `${year}`,
    };
  }

  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  if (/\bthis year\b/.test(normalized) || /\bytd\b/.test(normalized)) {
    return { from: startOfUtcYear(thisYear), to: addUtcMonths(startOfUtcYear(thisYear), 12), label: "this year" };
  }

  if (/\blast year\b/.test(normalized)) {
    return {
      from: startOfUtcYear(thisYear - 1),
      to: startOfUtcYear(thisYear),
      label: `${thisYear - 1}`,
    };
  }

  if (/\bthis month\b/.test(normalized)) {
    return { from: thisMonthStart, to: addUtcMonths(thisMonthStart, 1), label: "this month" };
  }

  if (/\blast month\b/.test(normalized)) {
    const lastMonthStart = addUtcMonths(thisMonthStart, -1);
    return { from: lastMonthStart, to: thisMonthStart, label: "last month" };
  }

  if (/\blast 30 days\b/.test(normalized) || /\b30d\b/.test(normalized)) {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return { from, to: new Date(), label: "last 30 days" };
  }

  const monthMatch = normalized.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/,
  );
  if (monthMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthIndex = monthNames.findIndex((name) => monthMatch[1].startsWith(name));
    const year = Number(monthMatch[2]);
    if (monthIndex >= 0) {
      const from = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
      return { from, to, label: `${monthMatch[1]} ${year}` };
    }
  }

  return null;
}

function categorySearchTerms(category: CategoryRow): string[] {
  const terms = new Set<string>();
  terms.add(category.name);
  terms.add(category.slug.replace(/-/g, " "));
  if (category.parent?.name) {
    terms.add(category.parent.name);
    terms.add(`${category.parent.name} ${category.name}`);
  }
  return [...terms].map(normalizeQueryText).filter(Boolean);
}

function scoreCategory(messageNorm: string, category: CategoryRow): number {
  const terms = categorySearchTerms(category);
  const tokens = messageNorm.split(" ").filter(Boolean);
  let score = 0;

  for (const term of terms) {
    if (!term) continue;
    if (messageNorm === term) score = Math.max(score, 100);
    if (messageNorm.includes(` ${term} `) || messageNorm.startsWith(`${term} `) || messageNorm.endsWith(` ${term}`) || messageNorm.includes(term)) {
      score = Math.max(score, 80 + Math.min(term.split(" ").length * 2, 10));
    }
    const matchedTokens = term.split(" ").filter((t) => tokens.includes(t)).length;
    if (matchedTokens > 0) {
      score = Math.max(score, matchedTokens * 10 + (category.parentId ? 2 : 0));
    }
  }

  return score;
}

function selectCategoryScope(categories: CategoryRow[], message: string): { categoryIds: string[]; categoryLabel: string | null } {
  const normalized = normalizeQueryText(message);
  if (!normalized) return { categoryIds: [], categoryLabel: null };

  let best: CategoryRow | null = null;
  let bestScore = 0;
  for (const category of categories) {
    const score = scoreCategory(normalized, category);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  if (!best || bestScore < 10) {
    return { categoryIds: [], categoryLabel: null };
  }

  const categoryIds = new Set<string>([best.id]);
  if (!best.parentId) {
    for (const child of categories) {
      if (child.parentId === best.id) {
        categoryIds.add(child.id);
      }
    }
  }

  const label = best.parent?.name ? `${best.parent.name} > ${best.name}` : best.name;
  return { categoryIds: [...categoryIds], categoryLabel: label };
}

function extractSearchTerms(message: string): string[] {
  const normalized = normalizeQueryText(message);
  if (!normalized) return [];
  const stopwords = new Set([
    "how",
    "much",
    "did",
    "i",
    "spend",
    "spent",
    "for",
    "on",
    "in",
    "at",
    "the",
    "a",
    "an",
    "to",
    "of",
    "and",
    "or",
    "this",
    "that",
    "last",
    "year",
    "month",
    "week",
    "today",
    "yesterday",
    "bao",
    "nhieu",
    "da",
    "tieu",
    "chi",
    "phi",
    "thu",
    "nhap",
    "trong",
    "vi",
    "cua",
    "cho",
    "nam",
    "thang",
  ]);

  return normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token) && !/^20\d{2}$/.test(token))
    .filter((token, index, arr) => arr.indexOf(token) === index);
}

function selectWalletScope(wallets: WalletRow[], message: string): { walletIds: string[]; walletLabel: string | null } {
  const normalized = normalizeQueryText(message);
  if (!normalized) return { walletIds: [], walletLabel: null };

  let best: WalletRow | null = null;
  let bestScore = 0;
  for (const wallet of wallets) {
    const walletNorm = normalizeQueryText(wallet.name);
    if (!walletNorm) continue;
    let score = 0;
    if (normalized === walletNorm) score = 100;
    else if (
      normalized.includes(` ${walletNorm} `) ||
      normalized.startsWith(`${walletNorm} `) ||
      normalized.endsWith(` ${walletNorm}`) ||
      normalized.includes(walletNorm)
    ) {
      score = 90 + Math.min(walletNorm.split(" ").length * 2, 10);
    } else {
      const tokens = normalized.split(" ").filter(Boolean);
      const matchedTokens = walletNorm.split(" ").filter((t) => tokens.includes(t)).length;
      if (matchedTokens > 0) score = matchedTokens * 12;
    }
    if (score > bestScore) {
      best = wallet;
      bestScore = score;
    }
  }

  if (!best || bestScore < 12) return { walletIds: [], walletLabel: null };
  return { walletIds: [best.id], walletLabel: best.name };
}

function removeScopeTerms(searchTerms: string[], scopes: Array<string | null>): string[] {
  const scopeTokens = new Set(
    scopes
      .flatMap((scope) => normalizeQueryText(scope ?? "").split(" "))
      .filter((token) => token.length >= 3),
  );
  return searchTerms.filter((term) => !scopeTokens.has(term));
}

function parseDirection(message: string): "out" | "in" {
  const normalized = normalizeQueryText(message);
  if (/\b(income|earned|earnings|revenue|deposit|inflow|thu nhap|tien vao|doanh thu)\b/.test(normalized)) return "in";
  return "out";
}

function parseSpendQuery(message: string, categories: CategoryRow[], wallets: WalletRow[]): ParsedSpendQuery | null {
  const timeRange = parseTimeRange(message);
  const { categoryIds, categoryLabel } = selectCategoryScope(categories, message);
  const { walletIds, walletLabel } = selectWalletScope(wallets, message);
  const direction = parseDirection(message);
  const searchTerms = removeScopeTerms(extractSearchTerms(message), [categoryLabel, walletLabel]);

  const normalized = normalizeQueryText(message);
  const spendIntent =
    /\b(spend|spent|spending|expense|expenses|total|how much|income|earned|earnings|revenue|bao nhieu|tieu|chi phi|thu nhap|doanh thu)\b/.test(normalized) ||
    timeRange !== null ||
    categoryIds.length > 0 ||
    walletIds.length > 0;

  if (!spendIntent) return null;
  if (!timeRange && categoryIds.length === 0 && walletIds.length === 0 && searchTerms.length === 0) return null;

  return { timeRange, categoryIds, categoryLabel, walletIds, walletLabel, searchTerms, direction };
}

function formatTransactionLine(tx: {
  occurredAt: Date;
  amountCents: number;
  merchant: string | null;
  memo: string | null;
  categoryName: string | null;
  walletName: string;
  currency: string;
}): string {
  const date = tx.occurredAt.toISOString().slice(0, 10);
  const label = tx.merchant ?? tx.memo ?? "Transaction";
  const category = tx.categoryName ?? "Uncategorized";
  return `${date} · ${label} · ${tx.walletName} · ${category} · ${money(tx.amountCents, tx.currency)}`;
}

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
    const categories = await prisma.category.findMany({
      where: { userId: session.user.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        parent: { select: { id: true, name: true, slug: true } },
      },
    });
    const wallets = await prisma.wallet.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });

    const spendQuery = parseSpendQuery(message, categories, wallets);
    if (spendQuery) {
      const where: Prisma.TransactionWhereInput = {
        userId: session.user.id,
        status: { not: "rejected" },
        direction: spendQuery.direction,
        currency: displayCurrency,
      };

      if (spendQuery.timeRange) {
        where.occurredAt = { gte: spendQuery.timeRange.from, lt: spendQuery.timeRange.to };
      }
      if (spendQuery.walletIds.length > 0) {
        where.walletId = { in: spendQuery.walletIds };
      }

      const textClauses =
        spendQuery.searchTerms.length > 0
          ? spendQuery.searchTerms.map((term) => ({
              OR: [{ merchant: { contains: term } }, { memo: { contains: term } }],
            }))
          : [];

      if (spendQuery.categoryIds.length > 0) {
        where.categoryId = { in: spendQuery.categoryIds };
      }
      if (textClauses.length > 0) {
        where.AND = textClauses;
      }

      const [transactions, totalCents, txCount] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: [{ occurredAt: "desc" }],
          take: 200,
          include: { wallet: true, category: { include: { parent: true } } },
        }),
        prisma.transaction.aggregate({
          where,
          _sum: { amountCents: true },
        }),
        prisma.transaction.count({ where }),
      ]);

      const spentCents = totalCents._sum.amountCents ?? 0;
      const scopeParts: string[] = [];
      if (spendQuery.walletLabel) scopeParts.push(spendQuery.walletLabel);
      if (spendQuery.categoryLabel) scopeParts.push(spendQuery.categoryLabel);
      if (spendQuery.searchTerms.length > 0) scopeParts.push(spendQuery.searchTerms.join(" "));
      if (spendQuery.timeRange) scopeParts.push(spendQuery.timeRange.label);
      const scope = scopeParts.length > 0 ? scopeParts.join(" · ") : "matching transactions";
      const sampleLines = transactions.slice(0, 8).map((tx) =>
        formatTransactionLine({
          occurredAt: tx.occurredAt,
          amountCents: tx.amountCents,
          merchant: tx.merchant,
          memo: tx.memo,
          categoryName: tx.category?.parent?.name
            ? `${tx.category.parent.name} > ${tx.category.name}`
            : tx.category?.name ?? "Uncategorized",
          walletName: tx.wallet.name,
          currency: tx.currency,
        }),
      );

      let response =
        spendQuery.direction === "in"
          ? `You received ${money(spentCents, displayCurrency)} from ${scope}.`
          : `You spent ${money(spentCents, displayCurrency)} on ${scope}.`;
      response += ` I found ${txCount} matching transaction${txCount === 1 ? "" : "s"}.`;
      if (sampleLines.length > 0) {
        response += ` Recent matches: ${sampleLines.join(" | ")}`;
        if (txCount > sampleLines.length) {
          response += ` | ...and ${txCount - sampleLines.length} more.`;
        }
      }
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
  } catch (err) {
    console.error("dashboardMiniChatAction failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Analytics chat failed.",
    };
  }
}
