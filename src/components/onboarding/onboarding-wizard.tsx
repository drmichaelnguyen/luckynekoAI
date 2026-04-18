"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";

import { completeOnboardingAction, type OnboardingState } from "@/actions/onboarding";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "VND"] as const;

const RECOMMENDED = ["Main", "Savings", "Credit card"] as const;

function SubmitOnboardingButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Đang lưu…
        </>
      ) : (
        "Vào chat với NekoZeni"
      )}
    </Button>
  );
}

export function OnboardingWizard() {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"recommended" | "custom" | null>(null);
  const [count, setCount] = useState(3);
  const [names, setNames] = useState<string[]>(() => ["Ví chính", "Tiết kiệm", "Chi tiêu phụ"]);
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("CAD");
  const [state, formAction] = useActionState(completeOnboardingAction, { error: null } satisfies OnboardingState);

  const syncNamesToCount = useCallback((n: number) => {
    setNames((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(`Ví ${next.length + 1}`);
      return next.slice(0, n);
    });
  }, []);

  const walletPayload = useMemo(() => {
    if (mode === "recommended") return [...RECOMMENDED];
    if (mode === "custom") return names.slice(0, count).map((s) => s.trim() || "Ví");
    return [];
  }, [mode, names, count]);

  const canAdvanceFromWallet =
    mode === "recommended" || (mode === "custom" && names.slice(0, count).every((n) => n.trim().length > 0));

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-amber-50/90 to-background dark:from-amber-950/25">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <div className="mb-6 flex items-center gap-2">
          {["Chào", "Ví", "Tiền tệ", "Xong"].map((label, i) => (
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
              <h1 className="text-2xl font-semibold tracking-tight">Chào bạn, mình là NekoZeni</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Dưới <strong>4 bước</strong>, mình hỏi vài thứ nhỏ: bạn dùng mấy ví, tên ví, loại tiền chính — phía sau
                dữ liệu vẫn được phân loại gọn; giao diện chat vẫn siêu đơn giản.
              </p>
              <Button className="mt-8 w-full" size="lg" onClick={() => setStep(1)}>
                Bắt đầu
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
              <h2 className="text-lg font-semibold">Bạn muốn mấy ví?</h2>
              <p className="text-sm text-muted-foreground">
                Mỗi ví là một &quot;ngăn&quot; tiền (chi tiêu hằng ngày, tiết kiệm, thẻ…). Chat sau này sẽ ghi đúng ví
                bạn chọn.
              </p>
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
                  <div className="font-medium">Gợi ý 3 ví</div>
                  <div className="mt-1 text-muted-foreground">Main · Savings · Credit card — phù hợp đa số.</div>
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
                  <div className="font-medium">Tự chọn 1–5 ví</div>
                  <div className="mt-1 text-muted-foreground">Đặt tên theo thói quen của bạn (vd. Tiền mặt, Momo, v.v.).</div>
                </button>
              </div>

              {mode === "custom" ? (
                <div className="space-y-3 rounded-xl border bg-card p-4">
                  <div className="text-xs font-medium text-muted-foreground">Số ví</div>
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
                    <div className="text-xs font-medium text-muted-foreground">Tên từng ví</div>
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
                        placeholder={`Ví ${idx + 1}`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-auto flex gap-2 pt-4">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(0)}>
                  Quay lại
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!mode || !canAdvanceFromWallet}
                  onClick={() => setStep(2)}
                >
                  Tiếp
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
              <h2 className="text-lg font-semibold">Tiền tệ chính</h2>
              <p className="text-sm text-muted-foreground">
                Dùng để hiển thị số dư & gợi ý từ chat. Bạn vẫn có thể ghi chi tiêu ngoại tệ sau; đây là &quot;mặc
                định&quot; báo cáo.
              </p>
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
                  Quay lại
                </Button>
                <Button type="button" className="flex-1" onClick={() => setStep(3)}>
                  Tiếp
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
              <h2 className="text-center text-lg font-semibold">Xong rồi!</h2>
              <ul className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Ví: </span>
                  {walletPayload.join(" · ")}
                </li>
                <li className="mt-2">
                  <span className="font-medium text-foreground">Tiền tệ: </span>
                  {currency}
                </li>
                <li className="mt-2 text-xs">
                  Danh mục chi tiêu chuẩn đã được tạo sẵn; bạn có thể chỉnh thêm trong Tools sau.
                </li>
              </ul>

              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

              <form action={formAction} className="mt-2 space-y-3">
                <input type="hidden" name="mode" value={mode ?? "recommended"} />
                <input type="hidden" name="currency" value={currency} />
                <input type="hidden" name="walletNames" value={JSON.stringify(walletPayload)} />
                <SubmitOnboardingButton />
              </form>

              <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(2)}>
                Quay lại chỉnh
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-8 flex justify-center border-t border-border/60 pt-6">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("common_language")}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </div>
  );
}
