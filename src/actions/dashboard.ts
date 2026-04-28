"use server";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

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
      byCategory: Array<{
        categoryId: string | null;
        name: string;
        icon: string | null;
        expenseCents: number;
        incomeCents: number;
      }>;
      byWallet: Array<{
        walletId: string;
        name: string;
        expenseCents: number;
        incomeCents: number;
      }>;
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
      prisma.category.findMany({ where: { userId }, select: { id: true, name: true, icon: true } }),
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

  const catMap = new Map(categories.map((c) => [c.id, c]));
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
  const byCategory = [...catIds].map((id) => {
    const cat = id ? catMap.get(id) : null;
    return {
      categoryId: id,
      name: cat?.name ?? "Uncategorized",
      icon: cat?.icon ?? null,
      expenseCents: expenseMap.get(id) ?? 0,
      incomeCents: incomeMap.get(id) ?? 0,
    };
  });
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
    walletId: id,
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

export type DashboardDrillLens = "category" | "wallet" | "merchant" | "overview";

const DrilldownInputSchema = z
  .object({
    range: z.enum(["30d", "month", "all"]),
    lens: z.enum(["category", "wallet", "merchant", "overview"]),
    categoryId: z.union([z.string().min(1), z.null()]).optional(),
    walletId: z.string().min(1).optional(),
    merchant: z.string().min(1).max(400).optional(),
    flow: z.enum(["out", "in", "all"]).default("all"),
  })
  .superRefine((d, ctx) => {
    if (d.lens === "category" && d.categoryId === undefined) {
      ctx.addIssue({ code: "custom", message: "categoryId required (or null for uncategorized)" });
    }
    if (d.lens === "wallet" && !d.walletId) {
      ctx.addIssue({ code: "custom", message: "walletId required" });
    }
    if (d.lens === "merchant" && !d.merchant) {
      ctx.addIssue({ code: "custom", message: "merchant required" });
    }
  });

export type DrilldownSeriesPoint = {
  period: string;
  periodLabel: string;
  outCents: number;
  inCents: number;
};

function shortDateLabel(isoDay: string): string {
  const parts = isoDay.split("-");
  if (parts.length !== 3) return isoDay;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return isoDay;
  return `${m}/${d}`;
}

export type DashboardDrilldownResult =
  | {
      ok: true;
      title: string;
      subtitle: string;
      series: DrilldownSeriesPoint[];
      transactions: Array<{
        id: string;
        occurredAt: string;
        direction: string;
        amountCents: number;
        merchant: string | null;
        memo: string | null;
        walletName: string;
        categoryName: string;
      }>;
    }
  | { ok: false; error: string };

function mondayUtcKey(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
}

export async function getLedgerDashboardDrilldownAction(
  input: z.infer<typeof DrilldownInputSchema>,
): Promise<DashboardDrilldownResult> {
  const parsed = DrilldownInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().formErrors.join(" ") || "Invalid request." };
  }

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const { range, lens, categoryId, walletId, merchant, flow } = parsed.data;
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredCurrency: true },
  });
  const displayCurrency = (user?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);

  const from = startDateForRange(range);
  const dateWhere = from ? { gte: from } : undefined;
  const weekMode = range === "all";

  const where: Prisma.TransactionWhereInput = {
    userId,
    currency: displayCurrency,
    status: { not: "rejected" },
    ...(dateWhere ? { occurredAt: dateWhere } : {}),
  };

  let title = "Activity";
  let subtitle = `${rangeLabel(range)} · ${displayCurrency}`;

  if (lens === "category") {
    where.categoryId = categoryId;
    if (categoryId) {
      const c = await prisma.category.findFirst({ where: { id: categoryId, userId } });
      title = c?.name ?? "Category";
    } else {
      title = "Uncategorized";
    }
  } else if (lens === "wallet" && walletId) {
    where.walletId = walletId;
    const w = await prisma.wallet.findFirst({ where: { id: walletId, userId } });
    title = w?.name ?? "Wallet";
  } else if (lens === "merchant" && merchant) {
    where.merchant = merchant;
    title = merchant;
    subtitle = `Merchant · ${subtitle}`;
  } else if (lens === "overview") {
    title = "All activity";
  }

  if (flow === "out") subtitle = `Outflows · ${subtitle}`;
  else if (flow === "in") subtitle = `Inflows · ${subtitle}`;

  const seriesRows = await prisma.transaction.findMany({
    where,
    select: { occurredAt: true, amountCents: true, direction: true },
    orderBy: { occurredAt: "asc" },
    take: 8000,
  });

  const bucket = new Map<string, { outCents: number; inCents: number }>();
  for (const t of seriesRows) {
    const key = weekMode ? mondayUtcKey(t.occurredAt) : t.occurredAt.toISOString().slice(0, 10);
    const cur = bucket.get(key) ?? { outCents: 0, inCents: 0 };
    if (t.direction === "out") cur.outCents += t.amountCents;
    else cur.inCents += t.amountCents;
    bucket.set(key, cur);
  }

  const series: DrilldownSeriesPoint[] = [...bucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, v]) => ({
      period: weekMode ? `week:${periodKey}` : periodKey,
      periodLabel: weekMode ? `W ${shortDateLabel(periodKey)}` : shortDateLabel(periodKey),
      outCents: v.outCents,
      inCents: v.inCents,
    }));

  const listWhere: Prisma.TransactionWhereInput = { ...where };
  if (flow === "out") listWhere.direction = "out";
  else if (flow === "in") listWhere.direction = "in";

  const rows = await prisma.transaction.findMany({
    where: listWhere,
    orderBy: { occurredAt: "desc" },
    take: 40,
    include: { wallet: true, category: true },
  });

  const transactions = rows.map((t) => ({
    id: t.id,
    occurredAt: t.occurredAt.toISOString(),
    direction: t.direction,
    amountCents: t.amountCents,
    merchant: t.merchant,
    memo: t.memo,
    walletName: t.wallet.name,
    categoryName: t.category?.name ?? "Uncategorized",
  }));

  return {
    ok: true,
    title,
    subtitle,
    series,
    transactions,
  };
}
