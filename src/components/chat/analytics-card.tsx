"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { getLedgerDashboardDrilldownAction, type DashboardDrilldownResult } from "@/actions/dashboard";
import { cn } from "@/lib/utils";

export type DashboardRange = "30d" | "month" | "all";

export type ChatAnalyticsPayload = {
  focus: "overview" | "spending" | "income" | "categories" | "wallets" | "merchants";
  range: DashboardRange;
  rangeLabel: string;
  fromIso: string | null;
  toIso: string | null;
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
};

export type ChatAnalyticsStructured = {
  documentKind: "analytics";
  analytics: ChatAnalyticsPayload;
};

type AnalyticsDrillSelection =
  | { lens: "overview"; flow: "out" | "in" | "all" }
  | { lens: "category"; categoryId: string | null; name: string; flow: "out" | "in"; level: "year" | "month" | "week" | "transaction"; year?: number; month?: number; weekStart?: string }
  | { lens: "wallet"; walletId: string; name: string; flow: "out" | "in" }
  | { lens: "merchant"; merchant: string; flow: "out" };

function formatMoney(cents: number, currency: string) {
  const value = (Math.abs(cents) / 100).toFixed(2);
  const sign = cents < 0 ? "−" : "";
  return `${sign}${currency} ${value}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function valueColor(ratio: number, mode: "expense" | "income"): string {
  const t = clamp01(ratio);
  if (mode === "expense") {
    const hue = 34 - t * 28;
    const saturation = 95;
    const lightness = 62 - t * 28;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }
  const hue = 182 + t * 44;
  const saturation = 90;
  const lightness = 63 - t * 28;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function donutSegmentColor(index: number): string {
  const hue = (index * 137.508 + 18) % 360;
  const cycle = index % 4;
  const saturation = 78;
  const lightness = [56, 64, 50, 70][cycle];
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
}

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
        Timeline (green = in, red = out) · drag horizontally if many days
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
                    className="w-full min-h-0 rounded-t-sm bg-emerald-500/80 transition-[height]"
                    style={{ height: `${Math.max(2, inH)}px` }}
                  />
                  <div
                    className="w-full min-h-0 rounded-b-sm bg-red-500/80 transition-[height]"
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

function DrillBucketGrid({
  buckets,
  flow,
  currency,
  level,
  onSelect,
  modeLabel,
}: {
  buckets: Array<{
    key: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    outCents: number;
    inCents: number;
    transactionCount: number;
  }>;
  flow: "out" | "in" | "all";
  currency: string;
  level: "year" | "month" | "week" | "transaction";
  onSelect: (bucket: { key: string; periodStart: string }) => void;
  modeLabel: string;
}) {
  if (buckets.length === 0) {
    return <p className="mt-4 text-xs text-muted-foreground">No entries found for this slice.</p>;
  }

  const getAmount = (bucket: (typeof buckets)[number]) =>
    flow === "in" ? bucket.inCents : flow === "out" ? bucket.outCents : bucket.outCents + bucket.inCents;

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {buckets.map((bucket) => {
          const amount = getAmount(bucket);
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onSelect({ key: bucket.key, periodStart: bucket.periodStart })}
              className="rounded-xl border bg-card px-3 py-3 text-left ring-offset-background transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{bucket.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{bucket.transactionCount} transactions</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(amount, currency)}</div>
                  {flow === "all" ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatMoney(bucket.inCents, currency)} in · {formatMoney(bucket.outCents, currency)} out
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    flow === "in" ? "bg-emerald-500" : flow === "out" ? "bg-red-500" : "bg-primary",
                  )}
                  style={{ width: "100%" }}
                />
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Tap a {modeLabel} bucket to drill deeper.
      </p>
    </div>
  );
}

function drillFlowLabel(flow: "out" | "in" | "all"): string {
  if (flow === "in") return "Income";
  if (flow === "out") return "Spending";
  return "Overview";
}

function InteractiveChartBlock<T extends { name: string; expenseCents: number; incomeCents: number; icon?: string | null }>({
  title,
  rows,
  currency,
  valueKey,
  onBarTap,
  enableCircleChart,
}: {
  title: string;
  rows: T[];
  currency: string;
  valueKey: "expenseCents" | "incomeCents";
  onBarTap?: (row: T) => void;
  enableCircleChart?: boolean;
}) {
  const [view, setView] = useState<"bar" | "circle">("bar");
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = rows.filter((r) => r[valueKey] > 0);
  const values = filtered.map((r) => r[valueKey]);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const total = values.reduce((sum, v) => sum + v, 0);
  const mode = valueKey === "expenseCents" ? "expense" : "income";

  useEffect(() => {
    setActiveIndex(0);
  }, [title, view, valueKey]);

  const activeSegment = useMemo(() => {
    if (filtered.length === 0) return null;
    return filtered[Math.min(activeIndex, filtered.length - 1)] ?? filtered[0] ?? null;
  }, [activeIndex, filtered]);

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border bg-card/50 px-3 py-3">
        <div className="text-xs font-medium text-foreground">{title}</div>
        <p className="mt-2 text-xs text-muted-foreground">No data in this range.</p>
      </div>
    );
  }

  const segments = filtered.map((row, index) => {
    const v = row[valueKey];
    const pct = total > 0 ? (v / total) * 100 : 0;
    return {
      pct,
      row,
      barColor: valueColor(v / max, mode),
      donutColor: donutSegmentColor(index),
    };
  });

  function makeArcLabel(seg: (typeof segments)[number], index: number) {
    const radius = 42;
    const strokeWidth = 12;
    const circumference = 2 * Math.PI * radius;
    const startOffset = segments
      .slice(0, index)
      .reduce((sum, prev) => sum + circumference * (prev.pct / 100), 0);
    const arc = circumference * (seg.pct / 100);
    const centerAngle = -Math.PI / 2 + (startOffset / circumference) * (Math.PI * 2) + (arc / circumference) * Math.PI;
    const outerRadius = radius + strokeWidth / 2 + 1.5;
    const labelRadius = radius + 19;
    const lineStart = {
      x: 60 + Math.cos(centerAngle) * outerRadius,
      y: 60 + Math.sin(centerAngle) * outerRadius,
    };
    const elbow = {
      x: 60 + Math.cos(centerAngle) * (radius + 12),
      y: 60 + Math.sin(centerAngle) * (radius + 12),
    };
    const labelAnchor = {
      x: 60 + Math.cos(centerAngle) * labelRadius,
      y: 60 + Math.sin(centerAngle) * labelRadius,
    };
    const isRight = Math.cos(centerAngle) >= 0;
    const labelX = isRight ? 104 : 16;
    const labelY = Math.max(12, Math.min(108, labelAnchor.y));
    return {
      lineStart,
      elbow,
      labelX,
      labelY,
      anchorX: isRight ? labelX - 1.5 : labelX + 1.5,
      anchorY: labelY,
      textAnchor: (isRight ? "start" : "end") as "start" | "end",
      displayPct: Math.round(seg.pct),
    };
  }

  return (
    <div className="rounded-xl border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-foreground">{title}</div>
        {enableCircleChart ? (
          <div className="flex rounded-md bg-muted p-0.5">
            <button
              type="button"
              className={cn(
                "rounded-sm px-2 py-0.5 text-[10px] transition",
                view === "bar" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setView("bar")}
            >
              Bar
            </button>
            <button
              type="button"
              className={cn(
                "rounded-sm px-2 py-0.5 text-[10px] transition",
                view === "circle" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setView("circle")}
            >
              Circle
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Tap a {view === "bar" ? "bar" : "segment"} for detail. Higher values render with stronger color.
      </p>

      {view === "bar" ? (
        <ul className="mt-3 space-y-2">
          {filtered.map((row) => {
            const v = row[valueKey];
            const pct = Math.round((v / max) * 100);
            const barColor = valueColor(v / max, mode);
            const selected = activeSegment?.name === row.name;
            return (
              <li key={`${row.name}-${valueKey}`} className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveIndex(filtered.findIndex((entry) => entry.name === row.name));
                    onBarTap?.(row);
                  }}
                  className={cn(
                    "w-full rounded-lg text-left ring-offset-background transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    selected ? "bg-muted/40" : null,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">{row.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {formatMoney(v, currency)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{ width: `${Math.max(4, pct)}%`, backgroundColor: barColor }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-3">
          <svg viewBox="0 0 120 120" className="h-32 w-32 overflow-visible">
            {segments.map((seg, index) => {
              const radius = 42;
              const strokeWidth = 12;
              const circumference = 2 * Math.PI * radius;
              const dash = circumference * (seg.pct / 100);
              const offset = segments.slice(0, index).reduce((sum, prev) => sum + circumference * (prev.pct / 100), 0);
              const label = makeArcLabel(seg, index);
              const strokeDasharray = `${dash} ${circumference - dash}`;
              return (
                <g key={seg.row.name}>
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={seg.donutColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={-offset - circumference / 4}
                    transform="rotate(-90 60 60)"
                    strokeLinecap="butt"
                    opacity={activeSegment?.name === seg.row.name ? 1 : 0.88}
                  />
                  <line
                    x1={label.lineStart.x}
                    y1={label.lineStart.y}
                    x2={label.elbow.x}
                    y2={label.elbow.y}
                    stroke={seg.donutColor}
                    strokeWidth="1.4"
                  />
                  <line
                    x1={label.elbow.x}
                    y1={label.elbow.y}
                    x2={label.anchorX}
                    y2={label.anchorY}
                    stroke={seg.donutColor}
                    strokeWidth="1.4"
                  />
                  <text
                    x={label.labelX}
                    y={label.labelY}
                    textAnchor={label.textAnchor}
                    dominantBaseline="middle"
                    className="fill-foreground text-[8px] font-medium"
                  >
                    {seg.row.name}
                    {" "}
                    ({label.displayPct}%)
                  </text>
                </g>
              );
            })}
            <text x="60" y="60" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-[9px] font-semibold">
              {Math.round(total / 100) > 0 ? `${Math.round(total / 100)}` : "0"}
            </text>
          </svg>
          {activeSegment ? (
            <div className="w-full rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Selected: <span className="font-medium text-foreground">{activeSegment.name}</span>{" "}
              <span className="tabular-nums">
                {formatMoney(activeSegment[valueKey], currency)}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AnalyticsChatCard({ analytics }: { analytics: ChatAnalyticsPayload }) {
  const [expanded, setExpanded] = useState(false);
  const [chartMode, setChartMode] = useState<"categories" | "wallets" | "income">(
    analytics.focus === "income" ? "income" : analytics.focus === "wallets" ? "wallets" : "categories",
  );
  const [drill, setDrill] = useState<AnalyticsDrillSelection | null>(null);
  const [drillData, setDrillData] = useState<Extract<DashboardDrilldownResult, { ok: true }> | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillPending, startDrill] = useTransition();

  useEffect(() => {
    setExpanded(false);
    setChartMode(analytics.focus === "income" ? "income" : analytics.focus === "wallets" ? "wallets" : "categories");
    setDrill(null);
    setDrillData(null);
    setDrillError(null);
  }, [
    analytics.focus,
    analytics.rangeLabel,
    analytics.displayCurrency,
    analytics.totals.expenseCents,
    analytics.totals.incomeCents,
    analytics.fromIso,
    analytics.toIso,
  ]);

  const categoryRows = analytics.byCategory.map((row) => ({
    name: row.name,
    expenseCents: row.expenseCents,
    incomeCents: row.incomeCents,
    icon: row.icon,
  }));
  const walletRows = analytics.byWallet.map((row) => ({
    name: row.name,
    expenseCents: row.expenseCents,
    incomeCents: row.incomeCents,
  }));

  const topCategory =
    analytics.byCategory
      .filter((row) => row.expenseCents > 0 || row.incomeCents > 0)
      .sort((a, b) => (chartMode === "income" ? b.incomeCents - a.incomeCents : b.expenseCents - a.expenseCents))[0] ??
    null;
  const topWallet =
    analytics.byWallet
      .filter((row) => row.expenseCents > 0 || row.incomeCents > 0)
      .sort((a, b) => b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents))[0] ?? null;
  const topMerchant = analytics.topMerchants[0] ?? null;

  const drillBreadcrumbs = useMemo(() => {
    const crumbs = ["Analytics", analytics.rangeLabel];
    if (!drill) return crumbs;
    if (drill.lens === "overview") {
      crumbs.push(drillFlowLabel(drill.flow));
      return crumbs;
    }
    if (drill.lens === "wallet") {
      crumbs.push(drillFlowLabel(drill.flow), "Wallets", drill.name);
      return crumbs;
    }
    if (drill.lens === "merchant") {
      crumbs.push("Spending", "Merchants", drill.merchant);
      return crumbs;
    }
    crumbs.push(drillFlowLabel(drill.flow), "Categories", drill.name);
    if (drill.level === "year") crumbs.push("Year");
    else if (drill.level === "month" && drill.year) crumbs.push(String(drill.year), "Month");
    else if (drill.level === "week" && drill.year && drill.month) crumbs.push(`${drill.year}-${String(drill.month).padStart(2, "0")}`, "Week");
    else if (drill.level === "transaction" && drill.year && drill.month) crumbs.push(`${drill.year}-${String(drill.month).padStart(2, "0")}`, "Transactions");
    return crumbs;
  }, [analytics.rangeLabel, drill]);

  const loadDrill = useCallback(
    (sel: AnalyticsDrillSelection) => {
      setDrill(sel);
      setDrillData(null);
      setDrillError(null);
      startDrill(() => {
        void (async () => {
          const base = {
            range: analytics.range,
            fromIso: analytics.fromIso ?? undefined,
            toIso: analytics.toIso ?? undefined,
            label: analytics.rangeLabel,
            flow: sel.flow,
          } as const;
          let payload: Parameters<typeof getLedgerDashboardDrilldownAction>[0];
          if (sel.lens === "overview") {
            payload = { ...base, lens: "overview" };
          } else if (sel.lens === "category") {
            if (sel.level === "year") {
              payload = { ...base, lens: "category", categoryId: sel.categoryId, level: "year" };
            } else if (sel.level === "month") {
              payload = { ...base, lens: "category", categoryId: sel.categoryId, level: "month", year: sel.year };
            } else if (sel.level === "week") {
              payload = {
                ...base,
                lens: "category",
                categoryId: sel.categoryId,
                level: "week",
                year: sel.year,
                month: sel.month,
              };
            } else {
              payload = {
                ...base,
                lens: "category",
                categoryId: sel.categoryId,
                level: "transaction",
                year: sel.year,
                month: sel.month,
                weekStart: sel.weekStart,
              };
            }
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
    [analytics.range, analytics.fromIso, analytics.toIso, analytics.rangeLabel, startDrill],
  );

  const handleBack = useCallback(() => {
    if (!drill || drill.lens !== "category") {
      setDrill(null);
      setDrillData(null);
      setDrillError(null);
      return;
    }
    if (drill.level === "year") {
      setDrill(null);
      setDrillData(null);
      setDrillError(null);
      return;
    }
    if (drill.level === "month") {
      loadDrill({ lens: "category", categoryId: drill.categoryId, name: drill.name, flow: drill.flow, level: "year" });
      return;
    }
    if (drill.level === "week") {
      loadDrill({
        lens: "category",
        categoryId: drill.categoryId,
        name: drill.name,
        flow: drill.flow,
        level: "month",
        year: drill.year,
      });
      return;
    }
    loadDrill({
      lens: "category",
      categoryId: drill.categoryId,
      name: drill.name,
      flow: drill.flow,
      level: "week",
      year: drill.year,
      month: drill.month,
    });
  }, [drill, loadDrill]);

  const handleCategoryBucketSelect = useCallback(
    (bucket: { key: string; periodStart: string }) => {
      if (!drill || drill.lens !== "category") return;
      if (drill.level === "year") {
        loadDrill({
          lens: "category",
          categoryId: drill.categoryId,
          name: drill.name,
          flow: drill.flow,
          level: "month",
          year: Number(bucket.key),
        });
        return;
      }
      if (drill.level === "month") {
        const [yearPart, monthPart] = bucket.key.split("-");
        loadDrill({
          lens: "category",
          categoryId: drill.categoryId,
          name: drill.name,
          flow: drill.flow,
          level: "week",
          year: Number(yearPart),
          month: Number(monthPart),
        });
        return;
      }
      if (drill.level === "week") {
        loadDrill({
          lens: "category",
          categoryId: drill.categoryId,
          name: drill.name,
          flow: drill.flow,
          level: "transaction",
          year: drill.year,
          month: drill.month,
          weekStart: bucket.key,
        });
      }
    },
    [drill, loadDrill],
  );

  const renderTransactions = (transactions: NonNullable<typeof drillData>["transactions"]) => {
    if (transactions.length === 0) {
      return <li className="text-muted-foreground">No transactions match this slice.</li>;
    }
    return transactions.map((t) => (
      <li key={t.id} className="flex flex-col gap-0.5 rounded-md border bg-muted/20 px-2 py-1.5">
        <div className="flex justify-between gap-2">
          <span className="font-medium text-foreground">
            {t.direction === "out" ? "Out" : "In"} · {formatMoney(t.amountCents, analytics.displayCurrency)}
          </span>
          <span className="shrink-0 text-muted-foreground">{t.occurredAt.slice(0, 10)}</span>
        </div>
        <div className="text-muted-foreground">
          {t.walletName} · {t.categoryName}
        </div>
        {(t.merchant || t.memo) && <div className="truncate text-muted-foreground">{t.merchant ?? t.memo}</div>}
      </li>
    ));
  };

  const drillContent = drill ? (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
      <div className="border-b bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {drillBreadcrumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="inline-flex items-center gap-1.5">
              {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
              <span className={cn("rounded-full px-2 py-0.5", index === drillBreadcrumbs.length - 1 ? "bg-background text-foreground" : "")}>
                {crumb}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">{drillData?.title ?? "Details"}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{drillData?.subtitle ?? "Loading…"}</p>
          </div>
          <button
            type="button"
            className="rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted/40"
            onClick={handleBack}
          >
            Back
          </button>
        </div>

        {drillPending ? (
          <p className="mt-4 text-xs text-muted-foreground">Loading detail…</p>
        ) : drillError ? (
          <p className="mt-4 text-xs text-destructive">{drillError}</p>
        ) : drillData ? (
          <>
            {drill.lens === "category" ? (
              <>
                <div className="mt-3 rounded-xl border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {drill.level === "year"
                    ? "Tap a year to narrow to months."
                    : drill.level === "month"
                      ? "Tap a month to narrow to weeks."
                      : drill.level === "week"
                        ? "Tap a week to open transactions."
                        : "Transactions for the selected week."}
                </div>
                <DrillBucketGrid
                  buckets={drillData.buckets}
                  flow={drill.flow}
                  currency={analytics.displayCurrency}
                  level={drill.level}
                  onSelect={handleCategoryBucketSelect}
                  modeLabel={drill.level}
                />
                {drill.level === "transaction" ? (
                  <div className="mt-4 border-t pt-3">
                    <div className="text-xs font-medium text-foreground">Transactions</div>
                    <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-[11px]">
                      {renderTransactions(drillData.transactions)}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <SeriesChart series={drillData.series} currency={analytics.displayCurrency} />
                <div className="mt-4 border-t pt-3">
                  <div className="text-xs font-medium text-foreground">Recent lines</div>
                  <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-[11px]">
                    {renderTransactions(drillData.transactions)}
                  </ul>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="mt-3 rounded-2xl border bg-card/95 px-3 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Analytics</div>
          <div className="text-[11px] text-muted-foreground">
            {analytics.rangeLabel} · {analytics.displayCurrency}
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>{analytics.totals.transactionCount} transactions</div>
          {analytics.totals.pendingCount > 0 ? <div>{analytics.totals.pendingCount} pending</div> : null}
        </div>
      </div>

      <div className="mt-3 rounded-xl border bg-muted/20 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-foreground">Analytics summary</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {analytics.rangeLabel} · tap expand to view charts and drilldowns.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted/40"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {expanded ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setChartMode("categories")}
              className={cn(
                "rounded-xl border px-2 py-2 text-left transition",
                chartMode === "categories" ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <div className="text-[10px] text-muted-foreground">Spending</div>
              <div className="mt-1 text-xs font-semibold tabular-nums">{formatMoney(analytics.totals.expenseCents, analytics.displayCurrency)}</div>
            </button>
            <button
              type="button"
              onClick={() => setChartMode("income")}
              className={cn(
                "rounded-xl border px-2 py-2 text-left transition",
                chartMode === "income" ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <div className="text-[10px] text-muted-foreground">Income</div>
              <div className="mt-1 text-xs font-semibold tabular-nums">{formatMoney(analytics.totals.incomeCents, analytics.displayCurrency)}</div>
            </button>
            <button
              type="button"
              onClick={() => setChartMode("wallets")}
              className={cn(
                "rounded-xl border px-2 py-2 text-left transition",
                chartMode === "wallets" ? "border-primary/40 bg-primary/5" : "bg-muted/20 hover:bg-muted/40",
              )}
            >
              <div className="text-[10px] text-muted-foreground">Wallets</div>
              <div className={cn("mt-1 text-xs font-semibold tabular-nums", analytics.totals.netCents >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                {formatMoney(Math.abs(analytics.totals.netCents), analytics.displayCurrency)}
              </div>
            </button>
          </div>

          <div className="mt-3 grid gap-3">
            <InteractiveChartBlock
              title={
                chartMode === "income"
                  ? "Income by category"
                  : chartMode === "wallets"
                    ? "Outflows by wallet"
                    : "Spending by category"
              }
              rows={chartMode === "wallets" ? walletRows : categoryRows}
              currency={analytics.displayCurrency}
              valueKey={chartMode === "income" ? "incomeCents" : "expenseCents"}
              enableCircleChart
              onBarTap={(row: { name: string; expenseCents: number; incomeCents: number; categoryId?: string | null; walletId?: string }) => {
                if (chartMode === "income") {
                  const match = analytics.byCategory.find((item) => item.name === row.name);
                  loadDrill({
                    lens: "category",
                    categoryId: match?.categoryId ?? null,
                    name: row.name,
                    flow: "in",
                    level: "year",
                  });
                  return;
                }
                if (chartMode === "wallets") {
                  const match = analytics.byWallet.find((item) => item.name === row.name);
                  loadDrill({
                    lens: "wallet",
                    walletId: match?.walletId ?? "",
                    name: row.name,
                    flow: "out",
                  });
                  return;
                }
                const match = analytics.byCategory.find((item) => item.name === row.name);
                loadDrill({
                  lens: "category",
                  categoryId: match?.categoryId ?? null,
                  name: row.name,
                  flow: "out",
                  level: "year",
                });
              }}
            />
          </div>

          <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground">
            <div>
              Top category: <span className="font-medium text-foreground">{topCategory?.name ?? "No category data"}</span>
              {topCategory ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="tabular-nums">
                    {formatMoney(chartMode === "income" ? topCategory.incomeCents : topCategory.expenseCents, analytics.displayCurrency)}
                  </span>
                </>
              ) : null}
            </div>
            <div>
              Top wallet: <span className="font-medium text-foreground">{topWallet?.name ?? "No wallet data"}</span>
              {topWallet ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="tabular-nums">
                    {formatMoney(topWallet.expenseCents + topWallet.incomeCents, analytics.displayCurrency)}
                  </span>
                </>
              ) : null}
            </div>
            {topMerchant ? (
              <div>
                Top merchant: <span className="font-medium text-foreground">{topMerchant.label}</span>{" "}
                <span className="tabular-nums">{formatMoney(topMerchant.expenseCents, analytics.displayCurrency)}</span>
              </div>
            ) : null}
          </div>

          {drillContent}
        </>
      ) : null}
    </div>
  );
}
