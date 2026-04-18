"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type DashboardRange = "30d" | "month" | "all";

export type LedgerDashboardResult =
  | {
      ok: true;
      range: DashboardRange;
      rangeLabel: string;
      fromIso: string | null;
      displayCurrency: string;
      totals: {
        expenseCents: number;
        incomeCents: number;
        netCents: number;
        transactionCount: number;
        pendingCount: number;
      };
      byCategory: Array<{ name: string; expenseCents: number; incomeCents: number }>;
      byWallet: Array<{ name: string; expenseCents: number; incomeCents: number }>;
      topMerchants: Array<{ label: string; expenseCents: number }>;
    }
  | { ok: false; error: string };

function startDateForRange(range: DashboardRange): Date | null {
  const now = new Date();
  if (range === "all") return null;
  if (range === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  // calendar month UTC
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

function rangeLabel(range: DashboardRange): string {
  if (range === "all") return "All time";
  if (range === "30d") return "Last 30 days";
  return "This month (UTC)";
}

export async function getLedgerDashboardAction(range: DashboardRange): Promise<LedgerDashboardResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const userId = session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredCurrency: true },
  });
  const displayCurrency = (user?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);

  const from = startDateForRange(range);
  const dateWhere = from ? { gte: from } : undefined;

  const baseWhere = {
    userId,
    currency: displayCurrency,
    status: { not: "rejected" as const },
    ...(dateWhere ? { occurredAt: dateWhere } : {}),
  };

  const [wallets, categories, expenseByCat, incomeByCat, expenseByWallet, incomeByWallet, merchants, txCount, pendingCount] =
    await Promise.all([
      prisma.wallet.findMany({ where: { userId }, select: { id: true, name: true } }),
      prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...baseWhere, direction: "out" },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...baseWhere, direction: "in" },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["walletId"],
        where: { ...baseWhere, direction: "out" },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["walletId"],
        where: { ...baseWhere, direction: "in" },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["merchant"],
        where: {
          ...baseWhere,
          direction: "out",
          merchant: { not: null },
        },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
        take: 6,
      }),
      prisma.transaction.count({ where: { ...baseWhere } }),
      prisma.transaction.count({
        where: { ...baseWhere, status: "pending_user" },
      }),
    ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));

  const expenseMap = new Map<string | null, number>();
  for (const row of expenseByCat) {
    expenseMap.set(row.categoryId, row._sum.amountCents ?? 0);
  }
  const incomeMap = new Map<string | null, number>();
  for (const row of incomeByCat) {
    incomeMap.set(row.categoryId, row._sum.amountCents ?? 0);
  }

  const catIds = new Set<string | null>([...expenseMap.keys(), ...incomeMap.keys()]);
  const byCategory = [...catIds].map((id) => ({
    name: id ? (catMap.get(id) ?? "Unknown") : "Uncategorized",
    expenseCents: expenseMap.get(id) ?? 0,
    incomeCents: incomeMap.get(id) ?? 0,
  }));
  byCategory.sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents));

  const wExpense = new Map<string, number>();
  for (const row of expenseByWallet) {
    wExpense.set(row.walletId, row._sum.amountCents ?? 0);
  }
  const wIncome = new Map<string, number>();
  for (const row of incomeByWallet) {
    wIncome.set(row.walletId, row._sum.amountCents ?? 0);
  }
  const walletIds = new Set([...wExpense.keys(), ...wIncome.keys()]);
  const byWallet = [...walletIds].map((id) => ({
    name: walletMap.get(id) ?? "Wallet",
    expenseCents: wExpense.get(id) ?? 0,
    incomeCents: wIncome.get(id) ?? 0,
  }));
  byWallet.sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents));

  let expenseCents = 0;
  let incomeCents = 0;
  for (const row of expenseByCat) {
    expenseCents += row._sum.amountCents ?? 0;
  }
  for (const row of incomeByCat) {
    incomeCents += row._sum.amountCents ?? 0;
  }

  const topMerchants = merchants
    .filter((m) => m.merchant && (m._sum.amountCents ?? 0) > 0)
    .map((m) => ({
      label: m.merchant as string,
      expenseCents: m._sum.amountCents ?? 0,
    }));

  return {
    ok: true,
    range,
    rangeLabel: rangeLabel(range),
    fromIso: from ? from.toISOString() : null,
    displayCurrency,
      totals: {
        expenseCents,
        incomeCents,
        netCents: incomeCents - expenseCents,
        transactionCount: txCount,
        pendingCount,
      },
    byCategory: byCategory.filter((c) => c.expenseCents > 0 || c.incomeCents > 0),
    byWallet: byWallet.filter((w) => w.expenseCents > 0 || w.incomeCents > 0),
    topMerchants,
  };
}
