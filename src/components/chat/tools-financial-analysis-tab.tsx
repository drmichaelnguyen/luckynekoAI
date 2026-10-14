"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import { getFinancialAnalysisAction } from "@/actions/finance";
import type { FinancialAnalysisReport, FinancialInsightSeverity } from "@/lib/finance/financial-analysis";
import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

function InsightIcon({ severity }: { severity: FinancialInsightSeverity }) {
  if (severity === "positive") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (severity === "warning" || severity === "critical")
    return <AlertTriangle className={cn("h-4 w-4", severity === "critical" ? "text-destructive" : "text-amber-600")} />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function severityBorder(severity: FinancialInsightSeverity): string {
  if (severity === "positive") return "border-emerald-500/30 bg-emerald-500/5";
  if (severity === "critical") return "border-destructive/40 bg-destructive/5";
  if (severity === "warning") return "border-amber-500/30 bg-amber-500/5";
  return "border-border bg-muted/20";
}

export function ToolsFinancialAnalysisTab({ active }: { active: boolean }) {
  const [report, setReport] = useState<FinancialAnalysisReport | null>(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  const load = useCallback((windowMonths: number) => {
    startTransition(async () => {
      setError(null);
      const r = await getFinancialAnalysisAction(windowMonths);
      if (!r.ok) {
        setError(r.error);
        setReport(null);
        return;
      }
      setReport(r.report);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    load(months);
  }, [active, months, load]);

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Financial analysis</h3>
          <p className="text-xs text-muted-foreground">
            Rule-based insights from your ledger — savings rate, category concentration, month-over-month shifts, and
            recurring load. Distinct from the chart Analytics tab.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([3, 6, 12] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={months === m ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setMonths(m)}
            disabled={loading}
          >
            {m} mo
          </Button>
        ))}
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {report ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Income" value={formatMoney(report.summary.incomeCents, report.displayCurrency)} positive />
            <MetricCard label="Expenses" value={formatMoney(report.summary.expenseCents, report.displayCurrency)} />
            <MetricCard
              label="Net"
              value={formatMoney(Math.abs(report.summary.netCents), report.displayCurrency)}
              positive={report.summary.netCents >= 0}
              prefix={report.summary.netCents >= 0 ? "+" : "−"}
            />
            <MetricCard
              label="Savings rate"
              value={
                report.summary.savingsRate != null
                  ? `${(report.summary.savingsRate * 100).toFixed(1)}%`
                  : "—"
              }
              positive={report.summary.savingsRate != null && report.summary.savingsRate >= 0.1}
            />
          </div>

          <p className="text-[10px] text-muted-foreground">
            {report.periodLabel} · {report.summary.transactionCount} transactions · avg{" "}
            {formatMoney(report.summary.avgDailySpendCents, report.displayCurrency)}/day spend
          </p>

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Insights</h4>
            <ul className="space-y-2">
              {report.insights.map((insight) => (
                <li
                  key={insight.id}
                  className={cn("rounded-xl border px-3 py-2.5", severityBorder(insight.severity))}
                >
                  <div className="flex gap-2">
                    <InsightIcon severity={insight.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{insight.title}</span>
                        {insight.metric ? (
                          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                            {insight.metric}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{insight.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {report.monthlyTrend.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly cash flow</h4>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[320px] border-collapse text-[11px]">
                  <thead className="border-b bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Month</th>
                      <th className="px-2 py-2 text-right font-medium">In</th>
                      <th className="px-2 py-2 text-right font-medium">Out</th>
                      <th className="px-2 py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.monthlyTrend.map((row) => (
                      <tr key={row.month} className="border-b border-border/40">
                        <td className="px-2 py-1.5">{row.month}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatMoney(row.incomeCents, report.displayCurrency)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatMoney(row.expenseCents, report.displayCurrency)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right font-medium tabular-nums",
                            row.netCents >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {row.netCents >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(row.netCents), report.displayCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report.categoryBreakdown.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where money went</h4>
              <ul className="space-y-1.5">
                {report.categoryBreakdown.map((row) => (
                  <li key={row.name} className="rounded-lg border bg-card px-3 py-2">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{row.sharePct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.min(row.sharePct, 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                      {formatMoney(row.expenseCents, report.displayCurrency)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border bg-muted/15 px-3 py-3 text-[11px]">
            <div className="flex items-center gap-2 font-medium">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              Recurring outflow (est. monthly)
            </div>
            <p className="mt-1 tabular-nums text-sm font-semibold">
              {formatMoney(report.recurring.monthlyOutflowCents, report.displayCurrency)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {report.recurring.seriesCount} active series
              {report.recurring.monthlyInflowCents > 0
                ? ` · est. inflow ${formatMoney(report.recurring.monthlyInflowCents, report.displayCurrency)}/mo`
                : ""}
            </p>
            {report.topMerchants.length > 0 ? (
              <div className="mt-3 border-t border-border/50 pt-3">
                <div className="flex items-center gap-2 font-medium">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  Top payees
                </div>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {report.topMerchants.slice(0, 5).map((m) => (
                    <li key={m.label} className="flex justify-between gap-2">
                      <span className="truncate">{m.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(m.expenseCents, report.displayCurrency)} ({m.sharePct}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : !loading && !error ? (
        <p className="text-xs text-muted-foreground">No analysis available.</p>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  positive,
  prefix,
}: {
  label: string;
  value: string;
  positive?: boolean;
  prefix?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          positive === true && "text-emerald-600 dark:text-emerald-400",
          positive === false && "text-foreground",
        )}
      >
        {prefix}
        {value}
      </div>
    </div>
  );
}
