"use client";

import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/locale-context";
import type { Locale } from "@/lib/i18n/config";

const options: { value: Locale; labelKey: "lang_en" | "lang_vi" }[] = [
  { value: "en", labelKey: "lang_en" },
  { value: "vi", labelKey: "lang_vi" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-border/80 bg-card/80 p-0.5 text-xs shadow-sm backdrop-blur-sm",
        className,
      )}
      role="group"
      aria-label={t("common_language")}
    >
      {options.map(({ value, labelKey }) => (
        <button
          key={value}
          type="button"
          onClick={() => void setLocale(value)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            locale === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
          )}
          aria-pressed={locale === value}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
