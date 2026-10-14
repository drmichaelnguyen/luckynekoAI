"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DashboardWindowInput, LedgerDashboardResult } from "@/actions/dashboard";
import { getLedgerDashboardAction } from "@/actions/dashboard";
import { getPendingConfirmCountAction } from "@/actions/finance";
import { AlertsPanel } from "@/components/chat/alerts-panel";
import { BottomNav } from "@/components/chat/bottom-nav";
import { DashboardInsights } from "@/components/chat/dashboard-insights";
import {
  currentMoneyStoryPeriod,
  moneyStoryDashboardWindow,
  type MoneyStoryPeriod,
} from "@/lib/finance/money-story-period";

export function AnalyticsPageClient() {
  const [period, setPeriod] = useState<MoneyStoryPeriod>(() => currentMoneyStoryPeriod());
  const [data, setData] = useState<Extract<LedgerDashboardResult, { ok: true }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const requestRef = useRef(0);

  const refreshPendingCount = useCallback(() => {
    void getPendingConfirmCountAction().then((r) => {
      if (r.ok) setPendingCount(r.count);
    });
  }, []);

  const load = useCallback((window: DashboardWindowInput) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    void (async () => {
      const result = await getLedgerDashboardAction(window);
      if (requestId !== requestRef.current) return;
      if (result.ok) setData(result);
      else setData(null);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    load(moneyStoryDashboardWindow(period));
  }, [load, period]);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount, alertsOpen]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_at_12%_0%,_hsla(160,55%,42%,0.16),_transparent_55%),radial-gradient(ellipse_at_88%_8%,_hsla(198,70%,48%,0.10),_transparent_48%)] dark:bg-[radial-gradient(ellipse_at_12%_0%,_hsla(160,45%,35%,0.18),_transparent_55%),radial-gradient(ellipse_at_88%_8%,_hsla(198,55%,40%,0.12),_transparent_48%)]"
      />

      <header className="relative z-20">
        <div className="mx-auto w-full max-w-3xl px-4 pb-1 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-800/70 dark:text-teal-200/70">
            NekoZeni
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            Money story
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Income, spending, and where it went — for this window.
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
        <DashboardInsights
          period={period}
          onPeriodChange={setPeriod}
          data={data}
          loading={loading}
        />
      </main>

      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        onChanged={refreshPendingCount}
      />

      <BottomNav
        pendingCount={pendingCount}
        onNotificationsClick={() => setAlertsOpen(true)}
      />
    </div>
  );
}
