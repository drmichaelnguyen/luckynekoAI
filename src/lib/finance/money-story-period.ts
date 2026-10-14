import type { DashboardWindowInput } from "@/actions/dashboard";

export type MoneyStoryViewMode = "month" | "year";

export type MoneyStoryPeriod = {
  mode: MoneyStoryViewMode;
  year: number;
  /** Zero-based month. Retained in year mode so switching views keeps the user's place. */
  month: number;
};

export function currentMoneyStoryPeriod(mode: MoneyStoryViewMode = "month"): MoneyStoryPeriod {
  const now = new Date();
  return { mode, year: now.getFullYear(), month: now.getMonth() };
}

function periodStart(period: MoneyStoryPeriod): Date {
  return period.mode === "month"
    ? new Date(period.year, period.month, 1, 0, 0, 0, 0)
    : new Date(period.year, 0, 1, 0, 0, 0, 0);
}

export function moneyStoryPeriodLabel(period: MoneyStoryPeriod): string {
  if (period.mode === "year") return String(period.year);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(periodStart(period));
}

export function shiftMoneyStoryPeriod(period: MoneyStoryPeriod, amount: -1 | 1): MoneyStoryPeriod {
  if (period.mode === "year") return { ...period, year: period.year + amount };
  const shifted = new Date(period.year, period.month + amount, 1);
  return { ...period, year: shifted.getFullYear(), month: shifted.getMonth() };
}

export function canMoveMoneyStoryPeriodForward(period: MoneyStoryPeriod): boolean {
  const current = currentMoneyStoryPeriod(period.mode);
  return periodStart(period).getTime() < periodStart(current).getTime();
}

export function moneyStoryDashboardWindow(period: MoneyStoryPeriod): DashboardWindowInput {
  const from = periodStart(period);
  const to =
    period.mode === "month"
      ? new Date(period.year, period.month + 1, 1, 0, 0, 0, 0)
      : new Date(period.year + 1, 0, 1, 0, 0, 0, 0);
  return {
    range: period.mode === "month" ? "month" : "all",
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    label: moneyStoryPeriodLabel(period),
  };
}
