"use client";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/** Fixed corner control so locale is available before login and app-wide. */
export function GlobalLanguageSwitcher() {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 sm:right-4 sm:top-4">
      <div className="pointer-events-auto">
        <LanguageSwitcher />
      </div>
    </div>
  );
}
