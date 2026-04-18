"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      const failed =
        !result ||
        (typeof result === "object" &&
          (("error" in result && Boolean(result.error)) ||
            ("ok" in result && result.ok === false)));
      if (failed) {
        setError(t("login_error_credentials"));
        return;
      }
      router.push(safeFrom);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

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

      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
      >
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={8}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("login_submit_pending") : t("login_submit")}
        </Button>
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
        <div className="flex flex-col items-center gap-2 border-t border-border/70 pt-4">
          <span className="text-xs font-medium text-muted-foreground">{t("common_language")}</span>
          <LanguageSwitcher />
        </div>
      </form>
    </div>
  );
}
