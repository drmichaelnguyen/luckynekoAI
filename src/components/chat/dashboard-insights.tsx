"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, useTransition, useRef, type TouchEvent } from "react";

import { dashboardMiniChatAction, type DashboardChatHistory } from "@/actions/dashboard-chat";
import type { DashboardDrilldownResult, LedgerDashboardResult } from "@/actions/dashboard";
import { getLedgerDashboardDrilldownAction } from "@/actions/dashboard";
import { TransactionDetailDrawer } from "@/components/chat/transaction-detail-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Sparkles, Send } from "lucide-react";

import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import {
  canMoveMoneyStoryPeriodForward,
  moneyStoryPeriodLabel,
  shiftMoneyStoryPeriod,
  type MoneyStoryPeriod,
  type MoneyStoryViewMode,
} from "@/lib/finance/money-story-period";

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency);
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

const FLOW_TONES = [
  "#0F766E",
  "#B45309",
  "#1D4ED8",
  "#BE123C",
  "#4D7C0F",
  "#0E7490",
  "#C2410C",
  "#334155",
] as const;

function flowTone(index: number): string {
  return FLOW_TONES[index % FLOW_TONES.length]!;
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
    <div className="mt-4 space-y-2">
      <div className="divide-y divide-border/70">
        {buckets.map((bucket) => {
          const amount = getAmount(bucket);
          const label = bucket.label;
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onSelect({ key: bucket.key, periodStart: bucket.periodStart })}
              className="flex w-full items-start justify-between gap-3 py-3.5 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {bucket.transactionCount} transactions
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {formatMoney(amount, currency)}
                </div>
                {flow === "all" ? (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatMoney(bucket.inCents, currency)} in · {formatMoney(bucket.outCents, currency)} out
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">Tap a {modeLabel} to go deeper.</p>
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
    <section className="mt-2 border-t border-teal-900/10 pt-6 dark:border-teal-100/10">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-700 dark:text-teal-300" />
        <h3 className="text-sm font-semibold text-foreground">Ask this view</h3>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Summaries, trends, or advice — scoped to the numbers above.
      </p>
      <div
        ref={chatRef}
        className="mt-3 max-h-[280px] min-h-[88px] space-y-3 overflow-y-auto"
      >
        {chatHistory.length === 0 ? (
          <p className="py-3 text-[11px] text-muted-foreground">
            Try “Where am I overspending?” or “Summarize this period.”
          </p>
        ) : (
          chatHistory.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex max-w-[88%] flex-col text-xs",
                msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start",
              )}
            >
              <span
                className={cn(
                  "whitespace-pre-wrap px-3 py-2",
                  msg.role === "user"
                    ? "rounded-2xl rounded-tr-md bg-teal-800 text-teal-50 dark:bg-teal-700"
                    : "rounded-2xl rounded-tl-md bg-muted text-foreground",
                )}
              >
                {msg.content}
              </span>
            </div>
          ))
        )}
        {isChatting ? (
          <div className="mr-auto flex max-w-[85%] items-start">
            <span className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-muted px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </span>
          </div>
        ) : null}
      </div>
      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2 border-b border-teal-900/15 pb-1 dark:border-teal-100/15">
        <Input
          placeholder="Ask about this period…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isChatting}
          className="h-10 flex-1 border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={!input.trim() || isChatting}
          className="h-9 w-9 shrink-0 p-0 text-teal-800 hover:text-teal-700 dark:text-teal-300"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}

export function DashboardInsights({
  period,
  onPeriodChange,
  data,
  loading,
}: {
  period: MoneyStoryPeriod;
  onPeriodChange: (period: MoneyStoryPeriod) => void;
  data: Extract<LedgerDashboardResult, { ok: true }> | null;
  loading: boolean;
}) {
  const [drill, setDrill] = useState<DrillSelection | null>(null);
  const [drillData, setDrillData] = useState<Extract<DashboardDrilldownResult, { ok: true }> | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillPending, startDrill] = useTransition();
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const movePeriod = useCallback(
    (amount: -1 | 1) => {
      if (amount === 1 && !canMoveMoneyStoryPeriodForward(period)) return;
      onPeriodChange(shiftMoneyStoryPeriod(period, amount));
    },
    [onPeriodChange, period],
  );

  const setViewMode = (mode: MoneyStoryViewMode) => {
    if (mode === period.mode) return;
    onPeriodChange({ ...period, mode });
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button, input, textarea, select, a")) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (touch) swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    movePeriod(dx < 0 ? 1 : -1);
  };

  const loadDrill = useCallback(
    (sel: DrillSelection) => {
      setDrill(sel);
      setDrillData(null);
      setDrillError(null);
      startDrill(() => {
        void (async () => {
          const base = {
            range: data?.range ?? (period.mode === "month" ? "month" : "all"),
            ...(data?.fromIso ? { fromIso: data.fromIso } : {}),
            ...(data?.toIso ? { toIso: data.toIso } : {}),
            ...(data?.rangeLabel ? { label: data.rangeLabel } : {}),
            flow: sel.flow,
          } as const;
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
    [data?.fromIso, data?.range, data?.rangeLabel, data?.toIso, period.mode],
  );

  useEffect(() => {
    setDrill(null);
    setDrillData(null);
    setDrillError(null);
  }, [period.mode, period.month, period.year]);

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

  const income = data?.totals.incomeCents ?? 0;
  const expense = data?.totals.expenseCents ?? 0;
  const net = data?.totals.netCents ?? 0;
  const spendRatio = income > 0 ? Math.min(1, expense / income) : expense > 0 ? 1 : 0;
  const savedPct = income > 0 ? Math.round(((income - expense) / income) * 100) : null;
  const spendingCategories = (data?.byCategory ?? [])
    .filter((row) => row.expenseCents > 0)
    .sort((a, b) => b.expenseCents - a.expenseCents);
  const incomeCategories = (data?.byCategory ?? [])
    .filter((row) => row.incomeCents > 0)
    .sort((a, b) => b.incomeCents - a.incomeCents);
  const spendingTotal = spendingCategories.reduce((sum, row) => sum + row.expenseCents, 0);
  const topMerchantSpend = data?.topMerchants[0]?.expenseCents ?? 0;

  const remainCents = Math.max(0, income - expense);
  const flowDenom = Math.max(income, expense, 1);
  const incomeShare = Math.round((income / flowDenom) * 100);
  const expenseShare = Math.round((expense / flowDenom) * 100);
  const remainShare = income > 0 ? Math.round((remainCents / income) * 100) : 0;

  return (
    <div
      className="space-y-8 touch-pan-y text-sm"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sticky top-0 z-10 -mx-4 border-b border-teal-900/10 bg-background/90 px-4 py-2 backdrop-blur dark:border-teal-100/10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-lg bg-muted/70 p-0.5">
            {(["month", "year"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={period.mode === mode}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition sm:px-3",
                  period.mode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => movePeriod(-1)}
              aria-label={`Previous ${period.mode}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[6.75rem] truncate text-center text-sm font-semibold tabular-nums sm:min-w-[8.5rem]">
              {moneyStoryPeriodLabel(period)}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => movePeriod(1)}
              disabled={!canMoveMoneyStoryPeriodForward(period)}
              aria-label={`Next ${period.mode}`}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-right text-[10px] text-muted-foreground sm:hidden">Swipe to change {period.mode}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Composing your money story…
        </div>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Could not load analytics.</p>
      ) : (
        <AnimatePresence mode="wait">
          {drill ? (
            <motion.div
              key="drill"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-800/70 dark:text-teal-200/70">
                    Drill-down
                  </p>
                  <h3 className="mt-1 truncate text-xl font-semibold tracking-tight">
                    {drillData?.title ?? "Details"}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {drillData?.subtitle ?? "Loading…"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1 text-teal-800 dark:text-teal-300"
                  onClick={handleDrillBack}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              </div>

              {drillPending ? (
                <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading detail…
                </div>
              ) : drillError ? (
                <p className="text-sm text-destructive">{drillError}</p>
              ) : drillData ? (
                <>
                  {drill.lens === "category" ? (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        {drill.level === "year"
                          ? "Choose a year, then month, then week."
                          : drill.level === "month"
                            ? "Choose a month to see weeks."
                            : drill.level === "week"
                              ? "Choose a week to open transactions."
                              : "Transactions in this week."}
                      </p>
                      <DrillBucketGrid
                        buckets={drillData.buckets}
                        flow={drill.flow}
                        currency={data.displayCurrency}
                        level={drill.level}
                        onSelect={handleCategoryBucketSelect}
                        modeLabel={drill.level}
                      />
                      {drill.level === "transaction" ? (
                        <div className="border-t border-teal-900/10 pt-4 dark:border-teal-100/10">
                          <div className="text-xs font-semibold text-foreground">Transactions</div>
                          <ul className="mt-2 max-h-56 space-y-0 overflow-y-auto text-[11px]">
                            {drillData.transactions.length === 0 ? (
                              <li className="py-3 text-muted-foreground">No transactions match this slice.</li>
                            ) : (
                              drillData.transactions.map((t) => (
                                <li
                                  key={t.id}
                                  className="cursor-pointer border-b border-border/60 py-3 transition hover:bg-muted/40 active:scale-[0.99]"
                                  onClick={() => setSelectedTxId(t.id)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") setSelectedTxId(t.id);
                                  }}
                                  aria-label={`Edit transaction: ${t.merchant ?? t.memo ?? "entry"}`}
                                >
                                  <div className="flex justify-between gap-2">
                                    <span className="font-medium text-foreground">
                                      {t.direction === "out" ? "Out" : "In"} ·{" "}
                                      {formatMoney(t.amountCents, data.displayCurrency)}
                                    </span>
                                    <span className="shrink-0 text-muted-foreground">
                                      {t.occurredAt.slice(0, 10)}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    {t.walletName} · {t.categoryName}
                                  </div>
                                  {t.merchant || t.memo ? (
                                    <div className="truncate text-muted-foreground">{t.merchant ?? t.memo}</div>
                                  ) : null}
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
                      <div className="border-t border-teal-900/10 pt-4 dark:border-teal-100/10">
                        <div className="text-xs font-semibold text-foreground">Recent lines</div>
                        <ul className="mt-2 max-h-56 space-y-0 overflow-y-auto text-[11px]">
                          {drillData.transactions.length === 0 ? (
                            <li className="py-3 text-muted-foreground">No transactions match this slice.</li>
                          ) : (
                            drillData.transactions.map((t) => (
                              <li
                                key={t.id}
                                className="cursor-pointer border-b border-border/60 py-3 transition hover:bg-muted/40 active:scale-[0.99]"
                                onClick={() => setSelectedTxId(t.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") setSelectedTxId(t.id);
                                }}
                                aria-label={`Edit transaction: ${t.merchant ?? t.memo ?? "entry"}`}
                              >
                                <div className="flex justify-between gap-2">
                                  <span className="font-medium text-foreground">
                                    {t.direction === "out" ? "Out" : "In"} ·{" "}
                                    {formatMoney(t.amountCents, data.displayCurrency)}
                                  </span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {t.occurredAt.slice(0, 10)}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {t.walletName} · {t.categoryName}
                                </div>
                                {t.merchant || t.memo ? (
                                  <div className="truncate text-muted-foreground">{t.merchant ?? t.memo}</div>
                                ) : null}
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
            <motion.div
              key="summary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-10"
            >
              {/* Hero: typographic net + flow tracks */}
              <section>
                <button
                  type="button"
                  onClick={() => loadDrill({ lens: "overview", flow: "all" })}
                  className="w-full text-left"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {data.rangeLabel} · {data.displayCurrency}
                  </p>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className={cn(
                      "mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl",
                      net >= 0 ? "text-teal-800 dark:text-teal-300" : "text-rose-700 dark:text-rose-400",
                    )}
                  >
                    {net >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(net), data.displayCurrency)}
                  </motion.p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {savedPct == null
                      ? `${data.totals.transactionCount} transactions`
                      : savedPct >= 0
                        ? `${savedPct}% of income still with you · ${data.totals.transactionCount} moves`
                        : `${Math.abs(savedPct)}% over income · ${data.totals.transactionCount} moves`}
                    {data.totals.pendingCount > 0 ? ` · ${data.totals.pendingCount} pending` : ""}
                  </p>
                </button>

                <div className="mt-6 space-y-3">
                  <button
                    type="button"
                    onClick={() => loadDrill({ lens: "overview", flow: "in" })}
                    className="group w-full text-left"
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-teal-800/80 dark:text-teal-200/80">
                        In
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-foreground group-hover:text-teal-800 dark:group-hover:text-teal-300">
                        {formatMoney(income, data.displayCurrency)}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden bg-teal-900/10 dark:bg-teal-100/10">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(income > 0 ? 6 : 0, incomeShare)}%` }}
                        transition={{ duration: 0.55, ease: "easeOut" }}
                        className="h-full bg-teal-700 dark:bg-teal-400"
                      />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => loadDrill({ lens: "overview", flow: "out" })}
                    className="group w-full text-left"
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-rose-800/80 dark:text-rose-200/80">
                        Out
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-foreground group-hover:text-rose-700 dark:group-hover:text-rose-300">
                        {formatMoney(expense, data.displayCurrency)}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden bg-rose-900/10 dark:bg-rose-100/10">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(expense > 0 ? 6 : 0, expenseShare)}%` }}
                        transition={{ duration: 0.55, ease: "easeOut", delay: 0.08 }}
                        className={cn(
                          "h-full",
                          spendRatio > 0.85 ? "bg-rose-600 dark:bg-rose-400" : "bg-rose-500/90 dark:bg-rose-500",
                        )}
                      />
                    </div>
                  </button>

                  {income > 0 ? (
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Left
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatMoney(remainCents, data.displayCurrency)}
                          <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                            {remainShare}%
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(net > 0 ? 4 : 0, remainShare)}%` }}
                          transition={{ duration: 0.55, ease: "easeOut", delay: 0.14 }}
                          className="h-full bg-foreground/35"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              {/* Spend mosaic */}
              <section>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">Where it went</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Tap a slice to drill in</p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatMoney(expense, data.displayCurrency)}
                  </span>
                </div>

                {spendingCategories.length === 0 ? (
                  <p className="mt-6 text-xs text-muted-foreground">No spending in this period yet.</p>
                ) : (
                  <>
                    <div className="mt-4 flex h-14 w-full overflow-hidden">
                      {spendingCategories.slice(0, 8).map((row, index) => {
                        const pct = spendingTotal > 0 ? (row.expenseCents / spendingTotal) * 100 : 0;
                        return (
                          <button
                            key={row.categoryId ?? row.name}
                            type="button"
                            title={`${row.name} · ${Math.round(pct)}%`}
                            onClick={() =>
                              loadDrill({
                                lens: "category",
                                categoryId: row.categoryId,
                                name: row.name,
                                flow: "out",
                                level: "year",
                              })
                            }
                            className="min-w-[4%] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              width: `${Math.max(4, pct)}%`,
                              backgroundColor: flowTone(index),
                            }}
                          />
                        );
                      })}
                    </div>

                    <ul className="mt-5 divide-y divide-border/70">
                      {spendingCategories.slice(0, 7).map((row, index) => {
                        const pct = spendingTotal > 0 ? Math.round((row.expenseCents / spendingTotal) * 100) : 0;
                        return (
                          <li key={row.categoryId ?? row.name}>
                            <button
                              type="button"
                              onClick={() =>
                                loadDrill({
                                  lens: "category",
                                  categoryId: row.categoryId,
                                  name: row.name,
                                  flow: "out",
                                  level: "year",
                                })
                              }
                              className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-muted/40"
                            >
                              <span
                                className="h-8 w-1.5 shrink-0"
                                style={{ backgroundColor: flowTone(index) }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  {row.icon ? (
                                    <img src={row.icon} alt="" className="h-4 w-4 rounded-sm object-cover" />
                                  ) : null}
                                  <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                                </span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">{pct}% of spend</span>
                              </span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                                {formatMoney(row.expenseCents, data.displayCurrency)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>

              {/* Income sources only — spend already covered by mosaic */}
              {incomeCategories.length > 0 ? (
                <section>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-800 dark:text-teal-300">
                    Money in
                  </h2>
                  <ul className="mt-3 space-y-3">
                    {incomeCategories.slice(0, 6).map((row) => {
                      const pct = income > 0 ? Math.round((row.incomeCents / income) * 100) : 0;
                      return (
                        <li key={`in-${row.categoryId ?? row.name}`}>
                          <button
                            type="button"
                            onClick={() =>
                              loadDrill({
                                lens: "category",
                                categoryId: row.categoryId,
                                name: row.name,
                                flow: "in",
                                level: "year",
                              })
                            }
                            className="w-full text-left transition hover:opacity-80"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-xs font-medium text-foreground">{row.name}</span>
                              <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-800 dark:text-teal-300">
                                {formatMoney(row.incomeCents, data.displayCurrency)}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1 overflow-hidden bg-teal-900/10 dark:bg-teal-100/10">
                              <div
                                className="h-full bg-teal-700 dark:bg-teal-400"
                                style={{ width: `${Math.max(4, pct)}%` }}
                              />
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {/* Wallets as slim dual tracks */}
              {data.byWallet.length > 0 ? (
                <section>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Wallets</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Activity across accounts</p>
                  <ul className="mt-4 space-y-5">
                    {data.byWallet.map((wallet) => {
                      const walletNet = wallet.incomeCents - wallet.expenseCents;
                      const denom = Math.max(wallet.incomeCents, wallet.expenseCents, 1);
                      return (
                        <li key={wallet.walletId}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium text-foreground">{wallet.name}</span>
                            <span
                              className={cn(
                                "shrink-0 text-xs font-semibold tabular-nums",
                                walletNet >= 0
                                  ? "text-teal-800 dark:text-teal-300"
                                  : "text-rose-700 dark:text-rose-300",
                              )}
                            >
                              {walletNet >= 0 ? "+" : "−"}
                              {formatMoney(Math.abs(walletNet), data.displayCurrency)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <button
                              type="button"
                              onClick={() =>
                                loadDrill({
                                  lens: "wallet",
                                  walletId: wallet.walletId,
                                  name: wallet.name,
                                  flow: "in",
                                })
                              }
                              className="flex w-full items-center gap-2"
                            >
                              <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-teal-800/70 dark:text-teal-200/70">
                                In
                              </span>
                              <div className="h-2 flex-1 overflow-hidden bg-teal-900/10 dark:bg-teal-100/10">
                                <div
                                  className="h-full bg-teal-700 dark:bg-teal-400"
                                  style={{
                                    width: `${Math.max(
                                      wallet.incomeCents > 0 ? 4 : 0,
                                      Math.round((wallet.incomeCents / denom) * 100),
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                                {formatMoney(wallet.incomeCents, data.displayCurrency)}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                loadDrill({
                                  lens: "wallet",
                                  walletId: wallet.walletId,
                                  name: wallet.name,
                                  flow: "out",
                                })
                              }
                              className="flex w-full items-center gap-2"
                            >
                              <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-rose-800/70 dark:text-rose-200/70">
                                Out
                              </span>
                              <div className="h-2 flex-1 overflow-hidden bg-rose-900/10 dark:bg-rose-100/10">
                                <div
                                  className="h-full bg-rose-500"
                                  style={{
                                    width: `${Math.max(
                                      wallet.expenseCents > 0 ? 4 : 0,
                                      Math.round((wallet.expenseCents / denom) * 100),
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                                {formatMoney(wallet.expenseCents, data.displayCurrency)}
                              </span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {/* Merchants ledger */}
              {data.topMerchants.length > 0 ? (
                <section>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">Top places</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Largest spend destinations</p>
                  <ol className="mt-4">
                    {data.topMerchants.map((m, i) => {
                      const pct = topMerchantSpend > 0 ? Math.round((m.expenseCents / topMerchantSpend) * 100) : 0;
                      return (
                        <li key={m.label} className="border-t border-border/70 first:border-t-0">
                          <button
                            type="button"
                            onClick={() => loadDrill({ lens: "merchant", merchant: m.label, flow: "out" })}
                            className="flex w-full items-center gap-3 py-3.5 text-left transition hover:bg-muted/40"
                          >
                            <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{m.label}</span>
                              <span
                                className="mt-2 block h-1 bg-rose-500/80"
                                style={{ width: `${Math.max(8, pct)}%` }}
                              />
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                              {formatMoney(m.expenseCents, data.displayCurrency)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}

              <DashboardAiAssistant dashboardData={data} />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <TransactionDetailDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onSaved={() => setSelectedTxId(null)}
      />
    </div>
  );
}
