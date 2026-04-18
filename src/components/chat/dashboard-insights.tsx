"use client";

import type { DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatMoney(cents: number, currency: string) {
  const v = (Math.abs(cents) / 100).toFixed(2);
  const sign = cents < 0 ? "−" : "";
  return `${sign}${currency} ${v}`;
}

function BarBlock({
  title,
  rows,
  currency,
  valueKey,
}: {
  title: string;
  rows: Array<{ name: string; expenseCents: number; incomeCents: number }>;
  currency: string;
  valueKey: "expenseCents" | "incomeCents";
}) {
  const values = rows.map((r) => r[valueKey]);
  const max = Math.max(1, ...values);
  const filtered = rows.filter((r) => r[valueKey] > 0);
  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border bg-card/50 px-3 py-3">
        <div className="text-xs font-medium text-foreground">{title}</div>
        <p className="mt-2 text-xs text-muted-foreground">No data in this range.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card px-3 py-3">
      <div className="text-xs font-medium text-foreground">{title}</div>
      <ul className="mt-3 space-y-3">
        {filtered.map((row) => {
          const v = row[valueKey];
          const pct = Math.round((v / max) * 100);
          return (
            <li key={`${row.name}-${valueKey}`} className="space-y-1">
              <div className="flex justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatMoney(v, currency)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    valueKey === "expenseCents" ? "bg-primary" : "bg-emerald-600/80",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DashboardInsights({
  range,
  onRangeChange,
  data,
  loading,
}: {
  range: DashboardRange;
  onRangeChange: (r: DashboardRange) => void;
  data: Extract<LedgerDashboardResult, { ok: true }> | null;
  loading: boolean;
}) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Snapshot of your ledger. Totals use your <span className="font-medium text-foreground">primary currency</span>{" "}
        only (same as chat); other currencies are excluded from these sums.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["30d", "30 days"],
            ["month", "This month"],
            ["all", "All time"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={range === id ? "secondary" : "outline"}
            className="text-xs"
            onClick={() => onRangeChange(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading analytics…</p>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Could not load dashboard.</p>
      ) : (
        <>
          <div className="rounded-xl border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            {data.rangeLabel}
            {data.fromIso ? ` · from ${data.fromIso.slice(0, 10)}` : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Money out</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatMoney(data.totals.expenseCents, data.displayCurrency)}
              </div>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">Money in</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatMoney(data.totals.incomeCents, data.displayCurrency)}
              </div>
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border p-3",
              data.totals.netCents >= 0
                ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/25"
                : "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/25",
            )}
          >
            <div className="text-[11px] font-medium text-muted-foreground">Net (in − out)</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(data.totals.netCents, data.displayCurrency)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{data.totals.transactionCount} lines</span>
              {data.totals.pendingCount > 0 ? (
                <span className="text-amber-800 dark:text-amber-200">
                  {data.totals.pendingCount} awaiting confirm
                </span>
              ) : null}
            </div>
          </div>

          <BarBlock
            title="Spending by category"
            rows={data.byCategory}
            currency={data.displayCurrency}
            valueKey="expenseCents"
          />

          <BarBlock title="Income by category" rows={data.byCategory} currency={data.displayCurrency} valueKey="incomeCents" />

          <div className="grid gap-3 sm:grid-cols-2">
            <BarBlock
              title="Outflows by wallet"
              rows={data.byWallet}
              currency={data.displayCurrency}
              valueKey="expenseCents"
            />
            <BarBlock
              title="Inflows by wallet"
              rows={data.byWallet}
              currency={data.displayCurrency}
              valueKey="incomeCents"
            />
          </div>

          {data.topMerchants.length > 0 ? (
            <div className="rounded-xl border bg-card px-3 py-3">
              <div className="text-xs font-medium text-foreground">Top payees (spend)</div>
              <ol className="mt-2 space-y-2 text-xs">
                {data.topMerchants.map((m, i) => (
                  <li key={m.label} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      {i + 1}. <span className="font-medium text-foreground">{m.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatMoney(m.expenseCents, data.displayCurrency)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
