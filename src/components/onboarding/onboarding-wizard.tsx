"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";

import { completeOnboardingAction, type OnboardingState } from "@/actions/onboarding";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/contexts/locale-context";
import { cn } from "@/lib/utils";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "VND"] as const;

const RECOMMENDED = ["Main", "Savings", "Credit card"] as const;

function SubmitOnboardingButton() {
  const { pending } = useFormStatus();
  const { t } = useLocale();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("onboarding_done_submit_pending")}
        </>
      ) : (
        t("onboarding_done_submit")
      )}
    </Button>
  );
}

export function OnboardingWizard() {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"recommended" | "custom" | null>(null);
  const [count, setCount] = useState(3);
  const [names, setNames] = useState<string[]>(() => ["Main", "Savings", "Spending"]);
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("CAD");
  const [state, formAction] = useActionState(completeOnboardingAction, { error: null } satisfies OnboardingState);

  const syncNamesToCount = useCallback((n: number) => {
    setNames((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(`Wallet ${next.length + 1}`);
      return next.slice(0, n);
    });
  }, []);

  const walletPayload = useMemo(() => {
    if (mode === "recommended") return [...RECOMMENDED];
    if (mode === "custom") return names.slice(0, count).map((s) => s.trim() || "Wallet");
    return [];
  }, [mode, names, count]);

  const canAdvanceFromWallet =
    mode === "recommended" || (mode === "custom" && names.slice(0, count).every((n) => n.trim().length > 0));

  const labels = [
    t("onboarding_step_welcome"),
    t("onboarding_step_wallets"),
    t("onboarding_step_currency"),
    t("onboarding_step_done"),
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-amber-50/90 to-background dark:from-amber-950/25">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <div className="mb-6 flex items-center gap-2">
          {labels.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-1">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                  i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </div>
              {i < 3 ? <div className="h-px flex-1 bg-border" /> : null}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 0 ? (
            <motion.div
              key="s0"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="flex flex-1 flex-col items-center text-center"
            >
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800/60">
                <LuckyNekoMascot variant="hero" celebrateOnMount />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding_welcome_title")}</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("onboarding_welcome_body")}</p>
              <Button className="mt-8 w-full" size="lg" onClick={() => setStep(1)}>
                {t("onboarding_welcome_start")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </motion.div>
          ) : null}

          {step === 1 ? (
            <motion.div
              key="s1"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="flex flex-1 flex-col gap-4"
            >
              <h2 className="text-lg font-semibold">{t("onboarding_wallets_title")}</h2>
              <p className="text-sm text-muted-foreground">{t("onboarding_wallets_subtitle")}</p>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode("recommended");
                    setCount(3);
                  }}
                  className={cn(
                    "rounded-xl border p-4 text-left text-sm transition-colors",
                    mode === "recommended" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium">{t("onboarding_wallets_recommended")}</div>
                  <div className="mt-1 text-muted-foreground">{t("onboarding_wallets_recommended_desc")}</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("custom");
                    syncNamesToCount(count);
                  }}
                  className={cn(
                    "rounded-xl border p-4 text-left text-sm transition-colors",
                    mode === "custom" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium">{t("onboarding_wallets_custom")}</div>
                  <div className="mt-1 text-muted-foreground">{t("onboarding_wallets_custom_desc")}</div>
                </button>
              </div>

              {mode === "custom" ? (
                <div className="space-y-3 rounded-xl border bg-card p-4">
                  <div className="text-xs font-medium text-muted-foreground">{t("onboarding_wallets_count_label")}</div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Button
                        key={n}
                        type="button"
                        size="sm"
                        variant={count === n ? "default" : "outline"}
                        onClick={() => {
                          setCount(n);
                          syncNamesToCount(n);
                        }}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-medium text-muted-foreground">{t("onboarding_wallets_names_label")}</div>
                    {names.slice(0, count).map((val, idx) => (
                      <Input
                        key={idx}
                        value={val}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNames((prev) => {
                            const cp = [...prev];
                            cp[idx] = v;
                            return cp;
                          });
                        }}
                        placeholder={`Wallet ${idx + 1}`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-auto flex gap-2 pt-4">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(0)}>
                  {t("onboarding_back")}
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!mode || !canAdvanceFromWallet}
                  onClick={() => setStep(2)}
                >
                  {t("onboarding_next")}
                </Button>
              </div>
            </motion.div>
          ) : null}

          {step === 2 ? (
            <motion.div
              key="s2"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="flex flex-1 flex-col gap-4"
            >
              <h2 className="text-lg font-semibold">{t("onboarding_currency_title")}</h2>
              <p className="text-sm text-muted-foreground">{t("onboarding_currency_subtitle")}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CURRENCIES.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    variant={currency === c ? "default" : "outline"}
                    className="h-11"
                    onClick={() => setCurrency(c)}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  {t("onboarding_back")}
                </Button>
                <Button type="button" className="flex-1" onClick={() => setStep(3)}>
                  {t("onboarding_next")}
                </Button>
              </div>
            </motion.div>
          ) : null}

          {step === 3 ? (
            <motion.div
              key="s3"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="flex flex-1 flex-col gap-4"
            >
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/40">
                  <LuckyNekoMascot variant="hero" celebrateOnMount={false} />
                </div>
              </div>
              <h2 className="text-center text-lg font-semibold">{t("onboarding_done_title")}</h2>
              <ul className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">{t("onboarding_done_summary_wallets")} </span>
                  {walletPayload.join(" · ")}
                </li>
                <li className="mt-2">
                  <span className="font-medium text-foreground">{t("onboarding_done_summary_currency")} </span>
                  {currency}
                </li>
                <li className="mt-2 text-xs">{t("onboarding_done_summary_hint")}</li>
              </ul>

              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

              <form action={formAction} className="mt-2 space-y-3">
                <input type="hidden" name="mode" value={mode ?? "recommended"} />
                <input type="hidden" name="currency" value={currency} />
                <input type="hidden" name="walletNames" value={JSON.stringify(walletPayload)} />
                <SubmitOnboardingButton />
              </form>

              <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(2)}>
                {t("onboarding_back")}
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
