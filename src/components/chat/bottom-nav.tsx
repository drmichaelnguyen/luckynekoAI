"use client";

import { BarChart2, Bell, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface BottomNavProps {
  pendingCount?: number;
  onNotificationsClick?: () => void;
}

export function BottomNav({ pendingCount = 0, onNotificationsClick }: BottomNavProps) {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isAnalytics = pathname === "/analytics";

  return (
    <nav
      className="relative border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-1">
        {/* Home */}
        <Link
          href="/"
          id="bottom-nav-home"
          aria-label="Go to chat"
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-all duration-150",
            isHome
              ? "text-primary"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <Home
            className={cn("h-6 w-6 transition-transform duration-150", isHome && "scale-110")}
            strokeWidth={isHome ? 2.5 : 1.8}
          />
          <span className="text-[10px] font-medium leading-none tracking-wide">Home</span>
          {isHome && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" aria-hidden />
          )}
        </Link>

        {/* Analytics */}
        <Link
          href="/analytics"
          id="bottom-nav-analytics"
          aria-label="Go to analytics"
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-all duration-150",
            isAnalytics
              ? "text-primary"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <BarChart2
            className={cn("h-6 w-6 transition-transform duration-150", isAnalytics && "scale-110")}
            strokeWidth={isAnalytics ? 2.5 : 1.8}
          />
          <span className="text-[10px] font-medium leading-none tracking-wide">Analytics</span>
          {isAnalytics && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" aria-hidden />
          )}
        </Link>

        {/* Notifications */}
        <button
          type="button"
          id="bottom-nav-notifications"
          aria-label={
            pendingCount > 0
              ? `Notifications — ${pendingCount} pending`
              : "Notifications"
          }
          onClick={onNotificationsClick}
          className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-muted-foreground transition-all duration-150 hover:bg-muted/60 hover:text-foreground"
        >
          <Bell className="h-6 w-6" strokeWidth={1.8} />
          <span className="text-[10px] font-medium leading-none tracking-wide">Alerts</span>
          {pendingCount > 0 && (
            <span
              className="absolute right-[calc(50%-18px)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
              aria-hidden
            >
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
