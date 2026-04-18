"use client";

import { useCallback, useEffect, useState } from "react";

import { localCalendarYmd } from "@/lib/date/local-ymd";

/** Local wall clock — 10 PM or later. */
const PROMPT_HOUR = 22;
const STORAGE_KEY = "nekozen:dailySpendPromptYmd";

/**
 * Once per calendar day (after 10:00 PM local), offer a spending check-in while the app is open.
 * Uses localStorage so it stays per-browser; no server scheduling.
 */
export function useDailySpendCheckin(isAuthed: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isAuthed || typeof window === "undefined") return;

    const evaluate = () => {
      const now = new Date();
      if (now.getHours() < PROMPT_HOUR) {
        setVisible(false);
        return;
      }
      try {
        if (localStorage.getItem(STORAGE_KEY) === localCalendarYmd(now)) {
          setVisible(false);
          return;
        }
      } catch {
        return;
      }
      setVisible(true);
    };

    evaluate();
    const interval = window.setInterval(evaluate, 60_000);
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, [isAuthed]);

  const acknowledge = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, localCalendarYmd(new Date()));
    } catch {
      /* private / blocked storage */
    }
    setVisible(false);
  }, []);

  return { visible, acknowledge };
}
