"use client";

import { useCallback, useEffect, useState } from "react";

import type { DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";
import { getLedgerDashboardAction } from "@/actions/dashboard";
import { DashboardInsights } from "@/components/chat/dashboard-insights";
import { BottomNav } from "@/components/chat/bottom-nav";

export function AnalyticsPageClient() {
  const [range, setRange] = useState<DashboardRange>("30d");
  const [data, setData] = useState<Extract<LedgerDashboardResult, { ok: true }> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((r: DashboardRange) => {
    setLoading(true);
    void (async () => {
      const result = await getLedgerDashboardAction(r);
      if (result.ok) setData(result);
      else setData(null);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const handleRangeChange = (r: DashboardRange) => {
    setRange(r);
    load(r);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1">
            <h1 className="text-base font-semibold leading-tight">Analytics</h1>
            <p className="text-xs text-muted-foreground">Spending overview & insights</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
        <DashboardInsights
          range={range}
          onRangeChange={handleRangeChange}
          data={data}
          loading={loading}
        />
      </main>

      <BottomNav />
    </div>
  );
}
