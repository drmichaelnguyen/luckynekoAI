"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { registerAction, type RegisterState } from "@/actions/register";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";
import { registerErrorMessageKey } from "@/lib/i18n/register-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function RegisterSubmit() {
  const { pending } = useFormStatus();
  const { t } = useLocale();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t("register_submit_pending") : t("register_submit")}
    </Button>
  );
}

export function RegisterForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const [state, formAction] = useActionState(registerAction, { errorKey: null } satisfies RegisterState);

  const loginHref =
    safeFrom !== "/" ? `/login?from=${encodeURIComponent(safeFrom)}` : "/login";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-amber-50/80 to-background px-4 py-10 dark:from-amber-950/20">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
          <LuckyNekoMascot variant="hero" celebrateOnMount />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("register_title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("register_subtitle")}</p>
      </div>

      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
      >
        <input type="hidden" name="redirectTo" value={safeFrom} />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("register_email")}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t("register_password")}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder={t("register_password_hint")}
            minLength={8}
          />
        </div>
        {state.errorKey ? (
          <p className="text-sm text-destructive">{t(registerErrorMessageKey[state.errorKey])}</p>
        ) : null}
        <RegisterSubmit />
        <p className="text-center text-sm text-muted-foreground">
          {t("register_has_account")}{" "}
          <Link href={loginHref} className="font-medium text-primary underline-offset-4 hover:underline">
            {t("register_sign_in")}
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground">
          <Link
            href="/guide"
            className="font-medium text-primary underline-offset-4 hover:underline"
            aria-label={t("guide_link_aria")}
          >
            {t("guide_link_label")}
          </Link>
        </p>
        <div className="flex flex-col items-center gap-2 border-t border-border/70 pt-4">
          <span className="text-xs font-medium text-muted-foreground">{t("common_language")}</span>
          <LanguageSwitcher />
        </div>
      </form>
    </div>
  );
}
