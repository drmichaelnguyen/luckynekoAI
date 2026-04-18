"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import type { DashboardDrilldownResult, DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";

type CategoryRow = {
  categoryId: string | null;
  name: string;
  expenseCents: number;
  incomeCents: number;
};
type WalletRow = {
  walletId: string;
  name: string;
  expenseCents: number;
  incomeCents: number;
};
import { getLedgerDashboardDrilldownAction } from "@/actions/dashboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatMoney(cents: number, currency: string) {
  const v = (Math.abs(cents) / 100).toFixed(2);
  const sign = cents < 0 ? "−" : "";
  return `${sign}${currency} ${v}`;
}

type DrillSelection =
  | { lens: "overview"; flow: "out" | "in" | "all" }
  | { lens: "category"; categoryId: string | null; name: string; flow: "out" | "in" }
  | { lens: "wallet"; walletId: string; name: string; flow: "out" | "in" }
  | { lens: "merchant"; merchant: string; flow: "out" };

function SeriesChart({
  series,
  currency,
}: {
  series: Extract<DashboardDrilldownResult, { ok: true }>["series"];
  currency: string;
}) {
  if (series.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">No time buckets in this range.</p>;
  }
  const max = Math.max(1, ...series.flatMap((p) => [p.outCents, p.inCents]));
  return (
    <div className="mt-4">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">
        Timeline (green = in, primary = out) · drag horizontally if many days
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-h-[128px] items-end gap-1.5 pt-1">
          {series.map((p) => {
            const inH = Math.round((p.inCents / max) * 80);
            const outH = Math.round((p.outCents / max) * 80);
            return (
              <div
                key={p.period}
                className="flex w-9 shrink-0 flex-col items-center gap-1"
                title={`${p.periodLabel}: in ${formatMoney(p.inCents, currency)} · out ${formatMoney(p.outCents, currency)}`}
              >
                <div className="flex min-h-[84px] w-full flex-col justify-end gap-px">
                  <div
                    className="w-full min-h-0 rounded-t-sm bg-emerald-500/75 transition-[height]"
                    style={{ height: `${Math.max(2, inH)}px` }}
                  />
                  <div
                    className="w-full min-h-0 rounded-b-sm bg-primary transition-[height]"
                    style={{ height: `${Math.max(2, outH)}px` }}
                  />
                </div>
                <span className="max-w-[2.25rem] truncate text-center text-[9px] leading-tight text-muted-foreground">
                  {p.periodLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InteractiveBarBlock<T extends { name: string; expenseCents: number; incomeCents: number }>({
  title,
  rows,
  currency,
  valueKey,
  onBarTap,
}: {
  title: string;
  rows: T[];
  currency: string;
  valueKey: "expenseCents" | "incomeCents";
  onBarTap: (row: T) => void;
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
      <p className="mt-1 text-[10px] text-muted-foreground">Tap a bar for detail and timeline.</p>
      <ul className="mt-3 space-y-2">
        {filtered.map((row) => {
          const v = row[valueKey];
          const pct = Math.round((v / max) * 100);
          return (
            <li key={`${row.name}-${valueKey}`} className="space-y-1">
              <button
                type="button"
                onClick={() => onBarTap(row)}
                className="w-full rounded-lg text-left ring-offset-background transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <div className="flex justify-between gap-2 px-0.5 text-[11px]">
                  <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatMoney(v, currency)}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      valueKey === "expenseCents" ? "bg-primary" : "bg-emerald-600/80",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
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
  const [drill, setDrill] = useState<DrillSelection | null>(null);
  const [drillData, setDrillData] = useState<Extract<DashboardDrilldownResult, { ok: true }> | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillPending, startDrill] = useTransition();

  const loadDrill = useCallback(
    (sel: DrillSelection) => {
      setDrill(sel);
      setDrillData(null);
      setDrillError(null);
      startDrill(() => {
        void (async () => {
          const base = { range, flow: sel.flow } as const;
          let payload: Parameters<typeof getLedgerDashboardDrilldownAction>[0];
          if (sel.lens === "overview") {
            payload = { ...base, lens: "overview" };
          } else if (sel.lens === "category") {
            payload = { ...base, lens: "category", categoryId: sel.categoryId };
          } else if (sel.lens === "wallet") {
            payload = { ...base, lens: "wallet", walletId: sel.walletId };
          } else {
            payload = { ...base, lens: "merchant", merchant: sel.merchant };
          }
          const r = await getLedgerDashboardDrilldownAction(payload);
          if (r.ok) {
            setDrillData(r);
            setDrillError(null);
          } else {
            setDrillData(null);
            setDrillError(r.error);
          }
        })();
      });
    },
    [range],
  );

  useEffect(() => {
    setDrill(null);
    setDrillData(null);
    setDrillError(null);
  }, [range]);

  const closeDrill = () => {
    setDrill(null);
    setDrillData(null);
    setDrillError(null);
  };

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
          <AnimatePresence mode="wait">
            {drill ? (
              <motion.div
                key="drill"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="rounded-xl border-2 border-primary/25 bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold leading-tight">
                      {drillData?.title ?? "Details"}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {drillData?.subtitle ?? "Loading…"}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={closeDrill}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </Button>
                </div>

                {drillPending ? (
                  <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading detail…
                  </div>
                ) : drillError ? (
                  <p className="mt-4 text-sm text-destructive">{drillError}</p>
                ) : drillData ? (
                  <>
                    <SeriesChart series={drillData.series} currency={data.displayCurrency} />
                    <div className="mt-5 border-t pt-3">
                      <div className="text-xs font-medium text-foreground">Recent lines</div>
                      <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-[11px]">
                        {drillData.transactions.length === 0 ? (
                          <li className="text-muted-foreground">No transactions match this slice.</li>
                        ) : (
                          drillData.transactions.map((t) => (
                            <li
                              key={t.id}
                              className="flex flex-col gap-0.5 rounded-md border bg-muted/20 px-2 py-1.5"
                            >
                              <div className="flex justify-between gap-2">
                                <span className="font-medium text-foreground">
                                  {t.direction === "out" ? "Out" : "In"} · {formatMoney(t.amountCents, data.displayCurrency)}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {t.occurredAt.slice(0, 10)}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                {t.walletName} · {t.categoryName}
                              </div>
                              {(t.merchant || t.memo) && (
                                <div className="truncate text-muted-foreground">{t.merchant ?? t.memo}</div>
                              )}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </>
                ) : null}
              </motion.div>
            ) : (
              <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="rounded-xl border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {data.rangeLabel}
                  {data.fromIso ? ` · from ${data.fromIso.slice(0, 10)}` : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => loadDrill({ lens: "overview", flow: "out" })}
                    className="rounded-xl border bg-card p-3 text-left ring-offset-background transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    <div className="text-[11px] text-muted-foreground">Money out · tap</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      {formatMoney(data.totals.expenseCents, data.displayCurrency)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadDrill({ lens: "overview", flow: "in" })}
                    className="rounded-xl border bg-card p-3 text-left ring-offset-background transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    <div className="text-[11px] text-muted-foreground">Money in · tap</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(data.totals.incomeCents, data.displayCurrency)}
                    </div>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => loadDrill({ lens: "overview", flow: "all" })}
                  className={cn(
                    "mt-2 w-full rounded-xl border p-3 text-left ring-offset-background transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    data.totals.netCents >= 0
                      ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                      : "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
                  )}
                >
                  <div className="text-[11px] font-medium text-muted-foreground">Net (in − out) · tap for full trend</div>
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
                </button>

                <div className="mt-4 space-y-4">
                  <InteractiveBarBlock<CategoryRow>
                    title="Spending by category"
                    rows={data.byCategory}
                    currency={data.displayCurrency}
                    valueKey="expenseCents"
                    onBarTap={(row) =>
                      loadDrill({ lens: "category", categoryId: row.categoryId, name: row.name, flow: "out" })
                    }
                  />
                  <InteractiveBarBlock<CategoryRow>
                    title="Income by category"
                    rows={data.byCategory}
                    currency={data.displayCurrency}
                    valueKey="incomeCents"
                    onBarTap={(row) =>
                      loadDrill({ lens: "category", categoryId: row.categoryId, name: row.name, flow: "in" })
                    }
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InteractiveBarBlock<WalletRow>
                      title="Outflows by wallet"
                      rows={data.byWallet}
                      currency={data.displayCurrency}
                      valueKey="expenseCents"
                      onBarTap={(row) =>
                        loadDrill({ lens: "wallet", walletId: row.walletId, name: row.name, flow: "out" })
                      }
                    />
                    <InteractiveBarBlock<WalletRow>
                      title="Inflows by wallet"
                      rows={data.byWallet}
                      currency={data.displayCurrency}
                      valueKey="incomeCents"
                      onBarTap={(row) =>
                        loadDrill({ lens: "wallet", walletId: row.walletId, name: row.name, flow: "in" })
                      }
                    />
                  </div>

                  {data.topMerchants.length > 0 ? (
                    <div className="rounded-xl border bg-card px-3 py-3">
                      <div className="text-xs font-medium text-foreground">Top payees (spend)</div>
                      <p className="mt-1 text-[10px] text-muted-foreground">Tap a row for merchant detail.</p>
                      <ol className="mt-2 space-y-1.5 text-xs">
                        {data.topMerchants.map((m, i) => (
                          <li key={m.label}>
                            <button
                              type="button"
                              onClick={() => loadDrill({ lens: "merchant", merchant: m.label, flow: "out" })}
                              className="flex w-full justify-between gap-2 rounded-md px-1 py-1.5 text-left ring-offset-background transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                            >
                              <span className="min-w-0 text-muted-foreground">
                                {i + 1}. <span className="font-medium text-foreground">{m.label}</span>
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {formatMoney(m.expenseCents, data.displayCurrency)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
