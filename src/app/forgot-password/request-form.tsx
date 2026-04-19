"use client";

import Link from "next/link";

import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";

const ADMIN_EMAIL = "dr.trongto@gmail.com";

export function ForgotPasswordForm() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-amber-50/80 to-background px-4 py-10 dark:from-amber-950/20">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
          <LuckyNekoMascot variant="hero" celebrateOnMount={false} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("forgot_password_title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("forgot_password_subtitle")}</p>
      </div>

      <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <p className="text-sm text-foreground">
          {t("forgot_password_contact_admin")}{" "}
          <a href={`mailto:${ADMIN_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {ADMIN_EMAIL}
          </a>
          .
        </p>
        <p className="text-xs text-muted-foreground">{t("forgot_password_admin_note")}</p>
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("forgot_password_back_to_login")}
          </Link>
        </p>
      </div>
    </div>
  );
}
