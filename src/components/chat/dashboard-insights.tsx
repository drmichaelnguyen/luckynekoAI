"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, useTransition, useRef } from "react";

import { dashboardMiniChatAction, type DashboardChatHistory } from "@/actions/dashboard-chat";
import type { DashboardDrilldownResult, DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";

type CategoryRow = {
  categoryId: string | null;
  name: string;
  icon: string | null;
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
import { TransactionDetailDrawer } from "@/components/chat/transaction-detail-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Sparkles, Send } from "lucide-react";

function formatMoney(cents: number, currency: string) {
  const v = (Math.abs(cents) / 100).toFixed(2);
  const sign = cents < 0 ? "−" : "";
  return `${sign}${currency} ${v}`;
}

type DrillSelection =
  | { lens: "overview"; flow: "out" | "in" | "all" }
  | CategoryDrillSelection
  | { lens: "wallet"; walletId: string; name: string; flow: "out" | "in" }
  | { lens: "merchant"; merchant: string; flow: "out" };

type CategoryDrillSelection =
  | { lens: "category"; categoryId: string | null; name: string; flow: "out" | "in"; level: "year" }
  | { lens: "category"; categoryId: string | null; name: string; flow: "out" | "in"; level: "month"; year: number }
  | { lens: "category"; categoryId: string | null; name: string; flow: "out" | "in"; level: "week"; year: number; month: number }
  | {
      lens: "category";
      categoryId: string | null;
      name: string;
      flow: "out" | "in";
      level: "transaction";
      year: number;
      month: number;
      weekStart: string;
    };

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
        Timeline (green = in, red = out) · drag horizontally if many days
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
  onBarTap: (row: T) => void;
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
    const pct = (v / total) * 100;
    return {
      pct,
      row,
      barColor: valueColor(v / max, mode),
      donutColor: donutSegmentColor(index),
    };
  });

  const activeSegment = segments[Math.min(activeIndex, segments.length - 1)] ?? segments[0] ?? null;
  const circleViewId = `circle-${title.replace(/\s+/g, "-").toLowerCase()}`;

  function makeArcLabel(seg: (typeof segments)[number], index: number) {
    const radius = 42;
    const strokeWidth = 12;
    const circumference = 2 * Math.PI * radius;
    const startOffset = segments
      .slice(0, index)
      .reduce((sum, prev) => sum + circumference * (prev.pct / 100), 0);
    const arc = circumference * (seg.pct / 100);
    const centerAngle = (-Math.PI / 2) + (startOffset / circumference) * (Math.PI * 2) + (arc / circumference) * Math.PI;
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
      centerAngle,
    };
  }

  return (
    <div className="rounded-xl border bg-card px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">{title}</div>
        {enableCircleChart && (
          <div className="flex bg-muted rounded-md p-0.5">
            <button
              type="button"
              className={cn("px-2 py-0.5 text-[10px] rounded-sm transition", view === "bar" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setView("bar")}
            >
              Bar
            </button>
            <button
              type="button"
              className={cn("px-2 py-0.5 text-[10px] rounded-sm transition", view === "circle" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setView("circle")}
            >
              Circle
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Tap a {view === "bar" ? "bar" : "segment"} for detail. The higher the amount, the {mode === "expense" ? "hotter" : "cooler"} the color.
      </p>
      
      {view === "bar" ? (
        <ul className="mt-3 space-y-2">
          {filtered.map((row) => {
            const v = row[valueKey];
            const pct = Math.round((v / max) * 100);
            const barColor = valueColor(v / max, mode);
            return (
              <li key={`${row.name}-${valueKey}`} className="space-y-1">
                <button
                  type="button"
                  onClick={() => onBarTap(row)}
                  className="w-full rounded-lg text-left ring-offset-background transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <div className="flex justify-between gap-2 px-0.5 text-[11px]">
                    <span className="min-w-0 flex items-center gap-1.5 truncate font-medium text-foreground">
                      {row.icon ? <img src={row.icon} alt="" className="h-4 w-4 rounded-sm object-cover" /> : null}
                      {row.name}
                    </span>
                    <span
                      className="shrink-0 font-medium"
                      style={{ color: barColor }}
                    >
                      {formatMoney(v, currency)}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: barColor,
                      }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex h-56 w-56 shrink-0 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-background via-muted/35 to-transparent" />
            <svg viewBox="0 0 120 120" className="relative h-full w-full overflow-visible drop-shadow-sm">
              <defs>
                <filter id={`chart-shadow-${circleViewId}`}>
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.12)" />
                </filter>
              </defs>
              {segments.map((seg, index) => {
                const radius = 42;
                const strokeWidth = 12;
                const circumference = 2 * Math.PI * radius;
                const arc = circumference * (seg.pct / 100);
                const offset =
                  circumference -
                  segments.slice(0, index).reduce((sum, prev) => sum + circumference * (prev.pct / 100), 0);
                const isActive = index === activeIndex;
                return (
                  <g key={seg.row.name}>
                    <circle
                      r={radius}
                      cx="60"
                      cy="60"
                      fill="transparent"
                      stroke={seg.donutColor}
                      strokeWidth={isActive ? strokeWidth + 2 : strokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={`${arc} ${circumference - arc}`}
                      strokeDashoffset={offset}
                      transform="rotate(-90 60 60)"
                      filter={`url(#chart-shadow-${circleViewId})`}
                      className={cn(
                        "cursor-pointer transition-[opacity,stroke-width,transform] hover:opacity-85 active:opacity-80",
                        isActive && "opacity-100",
                      )}
                      onClick={() => {
                        setActiveIndex(index);
                        onBarTap(seg.row);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      onFocus={() => setActiveIndex(index)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${seg.row.name}, ${Math.round(seg.pct)} percent, ${formatMoney(seg.row[valueKey], currency)}`}
                    />
                    {isActive ? (
                        <circle
                          r={radius - 1}
                          cx="60"
                          cy="60"
                          fill="transparent"
                        stroke="rgba(255,255,255,0.28)"
                        strokeWidth="1.25"
                        strokeDasharray={`${arc} ${circumference - arc}`}
                        strokeDashoffset={offset}
                        transform="rotate(-90 60 60)"
                        pointerEvents="none"
                      />
                    ) : null}
                    {segments.length > 1 ? (() => {
                      const label = makeArcLabel(seg, index);
                      return (
                        <g pointerEvents="none">
                          <polyline
                            points={`${label.lineStart.x.toFixed(1)},${label.lineStart.y.toFixed(1)} ${label.elbow.x.toFixed(1)},${label.elbow.y.toFixed(1)} ${label.anchorX.toFixed(1)},${label.anchorY.toFixed(1)}`}
                            fill="none"
                            stroke={seg.donutColor}
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={isActive ? 0.95 : 0.7}
                          />
                          <circle cx={label.anchorX} cy={label.anchorY} r="1.8" fill={seg.donutColor} opacity={isActive ? 1 : 0.8} />
                          <text
                            x={label.labelX}
                            y={label.labelY - 1.8}
                            textAnchor={label.textAnchor}
                            className="fill-foreground"
                            style={{ fontSize: "6px", fontWeight: 600 }}
                          >
                            {seg.row.name}
                          </text>
                          <text
                            x={label.labelX}
                            y={label.labelY + 4.2}
                            textAnchor={label.textAnchor}
                            className="fill-muted-foreground"
                            style={{ fontSize: "5px", fontWeight: 500 }}
                          >
                            {label.displayPct}%
                          </text>
                        </g>
                      );
                    })() : null}
                  </g>
                );
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-full">
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Total</div>
              <div className="mt-1 px-3 text-center text-sm font-semibold tabular-nums text-foreground">
                {activeSegment ? formatMoney(activeSegment.row[valueKey], currency) : formatMoney(total, currency)}
              </div>
              <div className="mt-0.5 max-w-[8rem] truncate text-center text-[10px] text-muted-foreground">
                {activeSegment ? activeSegment.row.name : "Select a segment"}
              </div>
            </div>
          </div>
          <ul className="w-full flex-1 space-y-1.5 overflow-y-auto max-h-44 pr-1 text-[10px] sm:max-h-48">
            {segments.map((seg) => (
              <li key={seg.row.name}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveIndex(segments.findIndex((candidate) => candidate.row.name === seg.row.name));
                    onBarTap(seg.row);
                  }}
                  onMouseEnter={() => setActiveIndex(segments.findIndex((candidate) => candidate.row.name === seg.row.name))}
                  className={cn(
                    "flex w-full items-center justify-between rounded-sm px-1 py-0.5 text-left transition hover:bg-muted/50",
                    seg.row.name === activeSegment?.row.name && "bg-muted/70",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-foreground">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: seg.donutColor }} />
                    {seg.row.icon ? <img src={seg.row.icon} className="h-3 w-3 rounded-sm object-cover" alt="" /> : null}
                    <span className="truncate">{seg.row.name}</span>
                  </span>
                  <span className="shrink-0 ml-2 font-medium text-muted-foreground">
                    {Math.round(seg.pct)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
          const label = bucket.label;
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onSelect({ key: bucket.key, periodStart: bucket.periodStart })}
              className="rounded-xl border bg-card px-3 py-3 text-left ring-offset-background transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{label}</div>
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

function DashboardAiAssistant({ dashboardData }: { dashboardData: Extract<LedgerDashboardResult, { ok: true }> }) {
  const [chatHistory, setChatHistory] = useState<DashboardChatHistory>([]);
  const [input, setInput] = useState("");
  const [isChatting, startChat] = useTransition();
  const chatRef = useRef<HTMLDivElement>(null);
  const storageKey = "nekozeni:analytics-chat";

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setChatHistory([]);
        return;
      }
      const parsed = JSON.parse(raw) as DashboardChatHistory;
      if (Array.isArray(parsed)) {
        setChatHistory(
          parsed
            .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-30),
        );
      }
    } catch {
      setChatHistory([]);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(chatHistory.slice(-30)));
    } catch {
      // Ignore storage failures; chat still works for the current page session.
    }
  }, [chatHistory, storageKey]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chatHistory, isChatting]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isChatting) return;
    const msg = input.trim();
    setInput("");
    const newHistory = [...chatHistory, { role: "user" as const, content: msg }];
    setChatHistory(newHistory);

    startChat(async () => {
      const res = await dashboardMiniChatAction(msg, newHistory.slice(0, -1), dashboardData);
      if (res.ok) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: res.response }]);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", content: `[Error] ${res.error}` }]);
      }
    });
  }

  return (
    <div className="mt-6 flex flex-col rounded-xl border bg-muted/20 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-xs font-semibold text-foreground border-b">
        <Sparkles className="h-4 w-4 text-primary" />
        Analytics AI Assistant
      </div>
      <div 
        ref={chatRef}
        className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[100px] max-h-[300px] text-xs"
      >
        {chatHistory.length === 0 ? (
          <p className="text-muted-foreground text-[11px] text-center italic py-4">
            Ask me to summarize your spending, identify trends, or give you advice based on your current view!
          </p>
        ) : (
          chatHistory.map((msg, i) => (
            <div key={i} className={cn("flex flex-col max-w-[85%]", msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start")}>
              <span className={cn("px-3 py-2 rounded-2xl whitespace-pre-wrap", msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm")}>
                {msg.content}
              </span>
            </div>
          ))
        )}
        {isChatting && (
          <div className="mr-auto items-start max-w-[85%]">
            <span className="px-3 py-2 rounded-2xl bg-muted rounded-tl-sm flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </span>
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t bg-background">
        <Input 
          placeholder="Ask about your analytics..." 
          value={input} 
          onChange={e => setInput(e.target.value)} 
          disabled={isChatting}
          className="h-9 text-xs flex-1 border-none shadow-none focus-visible:ring-0 px-2 bg-transparent"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={!input.trim() || isChatting} className="h-9 w-9 p-0 shrink-0 text-primary hover:text-primary/80">
          <Send className="h-4 w-4" />
        </Button>
      </form>
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
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

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
            if (sel.level === "year") {
              payload = { ...base, lens: "category", categoryId: sel.categoryId, level: "year" };
            } else if (sel.level === "month") {
              payload = {
                ...base,
                lens: "category",
                categoryId: sel.categoryId,
                level: "month",
                year: sel.year,
              };
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

  const handleDrillBack = () => {
    if (!drill || drill.lens !== "category") {
      closeDrill();
      return;
    }
    if (drill.level === "year") {
      closeDrill();
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
  };

  const handleCategoryBucketSelect = (bucket: { key: string; periodStart: string }) => {
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
                  <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={handleDrillBack}>
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
                    {drill.lens === "category" ? (
                      <>
                        <div className="rounded-xl border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
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
                          currency={data.displayCurrency}
                          level={drill.level}
                          onSelect={handleCategoryBucketSelect}
                          modeLabel={drill.level}
                        />
                        {drill.level === "transaction" ? (
                          <div className="mt-5 border-t pt-3">
                            <div className="text-xs font-medium text-foreground">Transactions</div>
                            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto text-[11px]">
                              {drillData.transactions.length === 0 ? (
                                <li className="text-muted-foreground">No transactions match this slice.</li>
                              ) : (
                                drillData.transactions.map((t) => (
                                  <li
                                    key={t.id}
                                    className="flex cursor-pointer flex-col gap-0.5 rounded-md border bg-muted/20 px-2 py-1.5 transition hover:bg-muted/50 active:scale-[0.99]"
                                    onClick={() => setSelectedTxId(t.id)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedTxId(t.id); }}
                                    aria-label={`Edit transaction: ${t.merchant ?? t.memo ?? "entry"}`}
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
                        ) : null}
                      </>
                    ) : (
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
                                  className="flex cursor-pointer flex-col gap-0.5 rounded-md border bg-muted/20 px-2 py-1.5 transition hover:bg-muted/50 active:scale-[0.99]"
                                  onClick={() => setSelectedTxId(t.id)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedTxId(t.id); }}
                                  aria-label={`Edit transaction: ${t.merchant ?? t.memo ?? "entry"}`}
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
                    )}
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
                    className="rounded-xl border border-red-200 bg-red-50/60 p-3 text-left ring-offset-background transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:border-red-900/40 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                  >
                    <div className="text-[11px] text-muted-foreground">Money out · tap</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                      {formatMoney(data.totals.expenseCents, data.displayCurrency)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadDrill({ lens: "overview", flow: "in" })}
                    className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-left ring-offset-background transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                  >
                    <div className="text-[11px] text-muted-foreground">Money in · tap</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
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
                  <InteractiveChartBlock<CategoryRow>
                    title="Spending by category"
                    rows={data.byCategory}
                    currency={data.displayCurrency}
                    valueKey="expenseCents"
                    enableCircleChart
                    onBarTap={(row) =>
                      loadDrill({ lens: "category", categoryId: row.categoryId, name: row.name, flow: "out", level: "year" })
                    }
                  />
                  <InteractiveChartBlock<CategoryRow>
                    title="Income by category"
                    rows={data.byCategory}
                    currency={data.displayCurrency}
                    valueKey="incomeCents"
                    enableCircleChart
                    onBarTap={(row) =>
                      loadDrill({ lens: "category", categoryId: row.categoryId, name: row.name, flow: "in", level: "year" })
                    }
                  />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InteractiveChartBlock<WalletRow>
                      title="Outflows by wallet"
                      rows={data.byWallet}
                      currency={data.displayCurrency}
                      valueKey="expenseCents"
                      onBarTap={(row) =>
                        loadDrill({ lens: "wallet", walletId: row.walletId, name: row.name, flow: "out" })
                      }
                    />
                    <InteractiveChartBlock<WalletRow>
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

                <DashboardAiAssistant dashboardData={data} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <TransactionDetailDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onSaved={() => setSelectedTxId(null)}
      />
    </div>
  );
}
