"use client";

import { motion } from "framer-motion";
import { Moon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/locale-context";

type Props = {
  onLogSpending: () => void;
  onDismiss: () => void;
};

export function DailySpendCheckinBanner({ onLogSpending, onDismiss }: Props) {
  const { t } = useLocale();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="mb-3 rounded-xl border border-amber-200/70 bg-amber-50/90 px-3 py-2.5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40"
      role="region"
      aria-label={t("daily_spend_checkin_aria")}
    >
      <div className="flex gap-2">
        <div className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-200">
          <Moon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium leading-snug text-amber-950 dark:text-amber-50">
            {t("daily_spend_checkin_body")}
          </p>
          <p className="text-[11px] leading-snug text-amber-900/85 dark:text-amber-100/80">
            {t("daily_spend_checkin_hint")}
          </p>
          <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:flex-wrap">
            <Button type="button" size="sm" className="h-11 w-full text-sm sm:h-9 sm:w-auto" onClick={onLogSpending}>
              {t("daily_spend_checkin_log")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-11 w-full text-sm sm:h-9 sm:w-auto" onClick={onDismiss}>
              {t("daily_spend_checkin_dismiss")}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
