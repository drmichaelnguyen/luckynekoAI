"use client";

import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getGuideContent } from "@/lib/i18n/guide-content";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";

export function GuidePageClient() {
  const { locale, t } = useLocale();
  const { status } = useSession();
  const content = getGuideContent(locale);
  const backHref = status === "authenticated" ? "/" : "/login";
  const backLabel = status === "authenticated" ? "Back to chat" : "Back to sign in";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-amber-50/80 to-background px-4 py-8 pb-16 dark:from-amber-950/20">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex flex-col gap-3">
          <Button variant="outline" size="sm" className="w-fit gap-2" asChild>
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
          <div className="flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-3 sm:items-center">
            <span className="text-xs font-medium text-muted-foreground">{t("common_language")}</span>
            <LanguageSwitcher />
          </div>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200/60 bg-card/80 p-4 shadow-sm dark:border-amber-900/40">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{content.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{content.lead}</p>
          </div>
        </div>

        <div className="space-y-10">
          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
              {section.paragraphs.map((p, i) => (
                <p key={`${section.heading}-p-${i}`} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {section.bullets && section.bullets.length > 0 ? (
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {section.bullets.map((b, i) => (
                    <li key={`${section.heading}-b-${i}`}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-muted-foreground">
          {locale === "vi"
            ? "Cần tài khoản? Đăng ký hoặc đăng nhập từ trang chủ."
            : "Need an account? Register or sign in from the home page."}{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            {locale === "vi" ? "Tạo tài khoản" : "Create account"}
          </Link>
          {" · "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {locale === "vi" ? "Đăng nhập" : "Sign in"}
          </Link>
        </p>
      </div>
    </div>
  );
}
