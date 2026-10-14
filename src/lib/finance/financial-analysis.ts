import type { FlowDirection, PrismaClient } from "@prisma/client";

export type FinancialInsightSeverity = "positive" | "neutral" | "warning" | "critical";

export type FinancialInsight = {
  id: string;
  severity: FinancialInsightSeverity;
  title: string;
  body: string;
  metric?: string;
};

export type FinancialAnalysisReport = {
  displayCurrency: string;
  periodLabel: string;
  generatedAt: string;
  summary: {
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    savingsRate: number | null;
    expenseToIncomeRatio: number | null;
    transactionCount: number;
    avgDailySpendCents: number;
  };
  insights: FinancialInsight[];
  categoryBreakdown: Array<{ name: string; expenseCents: number; sharePct: number }>;
  monthlyTrend: Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>;
  topMerchants: Array<{ label: string; expenseCents: number; sharePct: number }>;
  recurring: {
    monthlyOutflowCents: number;
    monthlyInflowCents: number;
    seriesCount: number;
  };
};

type TxRow = {
  amountCents: number;
  direction: FlowDirection;
  occurredAt: Date;
  merchant: string | null;
  category: { name: string; parent: { name: string } | null } | null;
};

function categoryLabel(category: TxRow["category"]): string {
  if (!category) return "Uncategorized";
  return category.parent ? `${category.parent.name} > ${category.name}` : category.name;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

function cadenceToMonthlyMultiplier(cadence: string): number {
  if (cadence === "weekly") return 52 / 12;
  if (cadence === "yearly") return 1 / 12;
  return 1;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export async function buildFinancialAnalysis(
  db: PrismaClient,
  input: { userId: string; displayCurrency: string; months?: number },
): Promise<FinancialAnalysisReport> {
  const monthsBack = input.months ?? 6;
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - monthsBack);
  from.setUTCHours(0, 0, 0, 0);

  const [transactions, recurring] = await Promise.all([
    db.transaction.findMany({
      where: {
        userId: input.userId,
        currency: input.displayCurrency,
        status: { not: "rejected" },
        occurredAt: { gte: from },
      },
      select: {
        amountCents: true,
        direction: true,
        occurredAt: true,
        merchant: true,
        category: { select: { name: true, parent: { select: { name: true } } } },
      },
      orderBy: { occurredAt: "asc" },
    }),
    db.recurrentSeries.findMany({
      where: { userId: input.userId, isPaused: false },
      select: { amountCents: true, direction: true, cadence: true },
    }),
  ]);

  let incomeCents = 0;
  let expenseCents = 0;
  const categoryExpenses = new Map<string, number>();
  const merchantExpenses = new Map<string, number>();
  const monthly = new Map<string, { incomeCents: number; expenseCents: number }>();

  for (const tx of transactions as TxRow[]) {
    const key = monthKey(tx.occurredAt);
    const bucket = monthly.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    if (tx.direction === "in") {
      incomeCents += tx.amountCents;
      bucket.incomeCents += tx.amountCents;
    } else {
      expenseCents += tx.amountCents;
      bucket.expenseCents += tx.amountCents;
      const cat = categoryLabel(tx.category);
      categoryExpenses.set(cat, (categoryExpenses.get(cat) ?? 0) + tx.amountCents);
      const merchant = (tx.merchant ?? "Unknown").trim() || "Unknown";
      merchantExpenses.set(merchant, (merchantExpenses.get(merchant) ?? 0) + tx.amountCents);
    }
    monthly.set(key, bucket);
  }

  const netCents = incomeCents - expenseCents;
  const savingsRate = incomeCents > 0 ? (incomeCents - expenseCents) / incomeCents : null;
  const expenseToIncomeRatio = incomeCents > 0 ? expenseCents / incomeCents : null;

  const daysSpan = Math.max(
    1,
    Math.ceil((Date.now() - from.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const avgDailySpendCents = Math.round(expenseCents / daysSpan);

  const categoryBreakdown = [...categoryExpenses.entries()]
    .map(([name, cents]) => ({ name, expenseCents: cents, sharePct: pct(cents, expenseCents) }))
    .sort((a, b) => b.expenseCents - a.expenseCents)
    .slice(0, 12);

  const topMerchants = [...merchantExpenses.entries()]
    .map(([label, cents]) => ({ label, expenseCents: cents, sharePct: pct(cents, expenseCents) }))
    .sort((a, b) => b.expenseCents - a.expenseCents)
    .slice(0, 8);

  const monthlyTrend = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month: monthLabel(month),
      incomeCents: v.incomeCents,
      expenseCents: v.expenseCents,
      netCents: v.incomeCents - v.expenseCents,
    }));

  let monthlyOutflowCents = 0;
  let monthlyInflowCents = 0;
  for (const series of recurring) {
    const mult = cadenceToMonthlyMultiplier(series.cadence);
    if (series.direction === "out") monthlyOutflowCents += Math.round(series.amountCents * mult);
    else monthlyInflowCents += Math.round(series.amountCents * mult);
  }

  const insights: FinancialInsight[] = [];

  if (transactions.length === 0) {
    insights.push({
      id: "no-data",
      severity: "neutral",
      title: "Not enough data yet",
      body: "Log income and spending for a few weeks so NekoZeni can surface savings rate, category concentration, and month-over-month trends.",
    });
  } else {
    if (savingsRate != null) {
      if (savingsRate < 0) {
        insights.push({
          id: "deficit",
          severity: "critical",
          title: "Spending exceeds income",
          body: `Over the last ${monthsBack} months you spent more than you earned. A sustainable budget needs expenses at or below income — review top categories and recurring bills first.`,
          metric: formatPct(Math.abs(savingsRate) * 100) + " over budget",
        });
      } else if (savingsRate < 0.1) {
        insights.push({
          id: "low-savings",
          severity: "warning",
          title: "Low savings rate",
          body: "Financial planners often target saving 10–20% of take-home pay. Your current rate is below 10% — small cuts in discretionary categories (dining, shopping) usually help first.",
          metric: formatPct(savingsRate * 100) + " saved",
        });
      } else if (savingsRate >= 0.2) {
        insights.push({
          id: "healthy-savings",
          severity: "positive",
          title: "Healthy savings rate",
          body: "You're saving at least 20% of income in this window — strong foundation for emergencies, debt payoff, or goals.",
          metric: formatPct(savingsRate * 100) + " saved",
        });
      } else {
        insights.push({
          id: "moderate-savings",
          severity: "neutral",
          title: "Moderate savings rate",
          body: "You're saving between 10% and 20% of income. Consider automating transfers to savings right after payday to push toward the upper end.",
          metric: formatPct(savingsRate * 100) + " saved",
        });
      }
    } else if (expenseCents > 0 && incomeCents === 0) {
      insights.push({
        id: "no-income-logged",
        severity: "warning",
        title: "No income logged in this period",
        body: "Expenses are recorded but income is missing — savings rate and cash-flow analysis need salary, deposits, or other inflows logged too.",
      });
    }

    const topCat = categoryBreakdown[0];
    if (topCat && topCat.sharePct >= 35) {
      insights.push({
        id: "category-concentration",
        severity: topCat.sharePct >= 50 ? "warning" : "neutral",
        title: "Spending concentrated in one category",
        body: `${topCat.name} accounts for a large share of outflows. If that's housing or debt, it's expected; if discretionary, compare against a monthly cap.`,
        metric: `${topCat.sharePct}% · ${topCat.name}`,
      });
    }

    if (monthlyTrend.length >= 2) {
      const prev = monthlyTrend[monthlyTrend.length - 2];
      const last = monthlyTrend[monthlyTrend.length - 1];
      if (prev.expenseCents > 0) {
        const change = (last.expenseCents - prev.expenseCents) / prev.expenseCents;
        if (change >= 0.2) {
          insights.push({
            id: "expense-spike",
            severity: "warning",
            title: "Spending jumped vs prior month",
            body: `Outflows rose sharply from ${prev.month} to ${last.month}. Check one-off purchases, travel, or bills that hit only in the latest month.`,
            metric: `+${formatPct(change * 100)} MoM`,
          });
        } else if (change <= -0.15 && last.expenseCents > 0) {
          insights.push({
            id: "expense-drop",
            severity: "positive",
            title: "Spending eased vs prior month",
            body: `Outflows fell from ${prev.month} to ${last.month}. If intentional, keep the habit; if missing data, log any gaps.`,
            metric: `${formatPct(change * 100)} MoM`,
          });
        }
      }
      if (last.netCents < 0) {
        insights.push({
          id: "negative-month",
          severity: "warning",
          title: "Last month was cash-flow negative",
          body: `${last.month} ended with more spending than income. One negative month is fine; repeated deficits need a budget reset.`,
          metric: `Net ${last.netCents < 0 ? "deficit" : "surplus"}`,
        });
      }
    }

    const diningCats = categoryBreakdown.filter((c) =>
      /\b(dining|restaurant|delivery|food|coffee|cafe)\b/i.test(c.name),
    );
    const diningTotal = diningCats.reduce((s, c) => s + c.expenseCents, 0);
    if (incomeCents > 0 && diningTotal / incomeCents > 0.15) {
      insights.push({
        id: "dining-heavy",
        severity: "neutral",
        title: "Dining & food is a large income share",
        body: "Rule of thumb: keep food away from home under ~10–15% of take-home pay. Meal planning or cooking more often is usually the fastest lever.",
        metric: formatPct(pct(diningTotal, incomeCents)) + " of income",
      });
    }

    if (monthlyOutflowCents > 0 && incomeCents > 0) {
      const fixedShare = monthlyOutflowCents / (incomeCents / monthsBack);
      if (fixedShare > 0.5) {
        insights.push({
          id: "high-fixed",
          severity: "warning",
          title: "Recurring bills dominate income",
          body: "Estimated monthly recurring outflows are over half of average monthly income. High fixed costs reduce flexibility — audit subscriptions and negotiate utilities/insurance when possible.",
          metric: `~${formatPct(fixedShare * 100)} of avg monthly income`,
        });
      }
    }

    const topMerchant = topMerchants[0];
    if (topMerchant && topMerchant.sharePct >= 20) {
      insights.push({
        id: "merchant-dominance",
        severity: "neutral",
        title: "One merchant drives a lot of spend",
        body: `${topMerchant.label} is your largest payee by volume. Confirm it's intentional (rent, childcare) or look for consolidation opportunities.`,
        metric: `${topMerchant.sharePct}% of expenses`,
      });
    }

    if (expenseToIncomeRatio != null && expenseToIncomeRatio <= 0.8 && savingsRate != null && savingsRate >= 0.1) {
      insights.push({
        id: "50-30-20",
        severity: "positive",
        title: "Room for the 50/30/20 framework",
        body: "A common split: ~50% needs, ~30% wants, ~20% savings/debt. Your numbers suggest you're not over-extended on total spending — tune category targets in Plans if you use them.",
      });
    }
  }

  return {
    displayCurrency: input.displayCurrency,
    periodLabel: `Last ${monthsBack} months`,
    generatedAt: new Date().toISOString(),
    summary: {
      incomeCents,
      expenseCents,
      netCents,
      savingsRate,
      expenseToIncomeRatio,
      transactionCount: transactions.length,
      avgDailySpendCents,
    },
    insights,
    categoryBreakdown,
    monthlyTrend,
    topMerchants,
    recurring: {
      monthlyOutflowCents,
      monthlyInflowCents,
      seriesCount: recurring.length,
    },
  };
}
