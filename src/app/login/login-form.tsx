"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, type LoginState } from "@/actions/login";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginSubmit() {
  const { pending } = useFormStatus();
  const { t } = useLocale();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t("login_submit_pending") : t("login_submit")}
    </Button>
  );
}

export function LoginForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const reset = searchParams.get("reset");
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const [state, formAction] = useActionState(loginAction, { error: null } satisfies LoginState);

  const registerHref =
    safeFrom !== "/" ? `/register?from=${encodeURIComponent(safeFrom)}` : "/register";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-amber-50/80 to-background px-4 py-10 dark:from-amber-950/20">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
          <LuckyNekoMascot variant="hero" celebrateOnMount={false} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("login_title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("login_subtitle")}</p>
      </div>

      <div className="mb-4 flex justify-center">
        <LanguageSwitcher />
      </div>

      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <input type="hidden" name="redirectTo" value={safeFrom} />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("login_email")}
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
            {t("login_password")}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            minLength={8}
          />
        </div>
        {reset === "success" ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("login_reset_success")}</p>
        ) : null}
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <LoginSubmit />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("login_forgot_password")}
          </Link>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          {t("login_no_account")}{" "}
          <Link href={registerHref} className="font-medium text-primary underline-offset-4 hover:underline">
            {t("login_create_one")}
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
      </form>
    </div>
  );
}
