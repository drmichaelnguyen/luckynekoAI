"use client";

import { useLocale } from "@/contexts/locale-context";

export function ClientLoading() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
      {t("common_loading")}
    </div>
  );
}
