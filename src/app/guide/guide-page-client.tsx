"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart2,
  Bell,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Home,
  MessageSquare,
  Mic,
  Paperclip,
  Share2,
  Smartphone,
  User,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
  content: React.ReactNode;
};

function StepCard({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className={cn("rounded-2xl border p-4 text-sm leading-relaxed", color)}>
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <span className="mt-0.5 shrink-0">💡</span>
      <span>{children}</span>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      <span>{children}</span>
    </li>
  );
}

const STEPS: Step[] = [
  {
    id: "chat",
    icon: MessageSquare,
    title: "Chat with NekoZeni",
    subtitle: "Your AI treasurer — just talk",
    color: "border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>The main screen is a chat. Type what you bought — or paste a receipt — and NekoZeni logs it for you.</p>
        <ul className="space-y-2">
          <Check>Type: <span className="font-medium">&ldquo;Coffee at Tim Hortons $3.50 today&rdquo;</span></Check>
          <Check>Or just paste a screenshot of your receipt</Check>
          <Check>NekoZeni replies with a summary and saves it to your ledger</Check>
        </ul>
        <Tip>You don&apos;t need to use a special format &mdash; natural language works best.</Tip>
      </div>
    ),
  },
  {
    id: "attach",
    icon: Camera,
    title: "Attach Receipts & Documents",
    subtitle: "Photos, PDFs, payroll slips",
    color: "border-purple-200 bg-purple-50/50 dark:border-purple-900/40 dark:bg-purple-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>Use the icons inside the chat box to attach files:</p>
        <ul className="space-y-2">
          <Check><span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> <strong>Attach</strong></span> — pick any image or PDF from your phone</Check>
          <Check><span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> <strong>Camera</strong></span> — opens your photo library directly</Check>
          <Check><span className="inline-flex items-center gap-1"><Mic className="h-3.5 w-3.5" /> <strong>Mic</strong></span> — speak instead of typing</Check>
        </ul>
        <Tip>Large photos are automatically compressed — full-page, well-lit receipts work best.</Tip>
      </div>
    ),
  },
  {
    id: "nav",
    icon: Home,
    title: "Bottom Navigation",
    subtitle: "Home · Analytics · Alerts",
    color: "border-green-200 bg-green-50/50 dark:border-green-900/40 dark:bg-green-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>The bar at the bottom of the screen has three tabs:</p>
        <ul className="space-y-2">
          <Check><span className="inline-flex items-center gap-1"><Home className="h-3.5 w-3.5" /> <strong>Home</strong></span> — returns to chat from anywhere</Check>
          <Check><span className="inline-flex items-center gap-1"><BarChart2 className="h-3.5 w-3.5" /> <strong>Analytics</strong></span> — spending charts, category breakdowns, wallet overview</Check>
          <Check><span className="inline-flex items-center gap-1"><Bell className="h-3.5 w-3.5" /> <strong>Alerts</strong></span> — notifications that need your attention (a red badge appears when there are items)</Check>
        </ul>
        <Tip>The Alerts tab turns red when NekoZeni has a pending question or a transaction awaiting your confirm.</Tip>
      </div>
    ),
  },
  {
    id: "tools",
    icon: Wallet,
    title: "Advanced Tools",
    subtitle: "Wallets · Plans · Import · Backup",
    color: "border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>Tap your <strong>avatar in the top-right corner</strong> to open the full toolset:</p>
        <ul className="space-y-2">
          <Check><strong>Analytics</strong> — same charts as the Analytics tab, with drill-down</Check>
          <Check><strong>Confirm</strong> — approve recurring vs one-time transactions</Check>
          <Check><strong>Wallets</strong> — create wallets (Main, Savings, Credit Card…)</Check>
          <Check><strong>Plans</strong> — set budgets and savings goals</Check>
          <Check><strong>Import</strong> — paste a bank CSV and let AI categorise it</Check>
          <Check><strong>Backup</strong> — download JSON or full ZIP backup</Check>
          <Check><strong>Profile</strong> — name, photo, language, password</Check>
        </ul>
        <Tip>Wallets and plans are visible to the AI in chat — it uses them to record transactions correctly.</Tip>
      </div>
    ),
  },
  {
    id: "profile",
    icon: User,
    title: "Your Profile & Settings",
    subtitle: "Name · Language · Password",
    color: "border-pink-200 bg-pink-50/50 dark:border-pink-900/40 dark:bg-pink-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>Open the <strong>Profile tab</strong> inside Advanced Tools (tap your avatar):</p>
        <ul className="space-y-2">
          <Check>Set your <strong>name</strong> and <strong>nickname</strong> — the AI will use your nickname in conversation</Check>
          <Check>Upload a <strong>profile photo</strong> — it shows in the top-right avatar</Check>
          <Check>Switch language between <strong>English</strong> and <strong>Tiếng Việt</strong></Check>
          <Check><strong>Change password</strong> is collapsed — tap it to expand when needed</Check>
          <Check>Tap <strong>Sign out</strong> at the bottom of the profile tab</Check>
        </ul>
      </div>
    ),
  },
  {
    id: "pwa",
    icon: Smartphone,
    title: "Install as Phone App",
    subtitle: "No app store needed — PWA",
    color: "border-cyan-200 bg-cyan-50/50 dark:border-cyan-900/40 dark:bg-cyan-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>NekoZeni is a Progressive Web App — install it from your browser for a full native-app experience:</p>
        <div className="relative aspect-square w-full max-w-[240px] mx-auto overflow-hidden rounded-xl border bg-white shadow-sm my-4">
          <Image
            src="/images/guide/pwa_install_instruction.png"
            alt="Illustration showing Add to Home Screen button in a mobile browser"
            fill
            className="object-cover"
          />
        </div>
        <ul className="space-y-2">
          <Check><strong>iPhone/iPad (Safari):</strong> tap Share &rarr; &ldquo;Add to Home Screen&rdquo; &rarr; Add</Check>
          <Check><strong>Android (Chrome):</strong> menu (&#8942;) &rarr; &ldquo;Install app&rdquo; or &ldquo;Add to Home Screen&rdquo;</Check>
          <Check>Once installed, open from your home screen for full-screen mode</Check>
        </ul>
        <Tip>Install the PWA first, then use your phone&apos;s Share sheet to send receipts directly from Photos or Gallery into NekoZeni.</Tip>
      </div>
    ),
  },
  {
    id: "share",
    icon: Share2,
    title: "Share Receipts from Gallery",
    subtitle: "iPhone & Android share sheet",
    color: "border-teal-200 bg-teal-50/50 dark:border-teal-900/40 dark:bg-teal-950/20",
    content: (
      <div className="space-y-3 text-sm text-foreground/90">
        <p>After installing NekoZeni as a PWA, you can share receipts directly from your camera roll:</p>
        <div className="relative aspect-square w-full max-w-[240px] mx-auto overflow-hidden rounded-xl border bg-white shadow-sm my-4">
          <Image
            src="/images/guide/share_sheet_instruction.png"
            alt="Illustration showing native share sheet with NekoZeni app icon"
            fill
            className="object-cover"
          />
        </div>
        <ul className="space-y-2">
          <Check><strong>iPhone:</strong> Photos → select receipt → Share → find NekoZeni (swipe and tap More if needed)</Check>
          <Check><strong>Android:</strong> Gallery → select image → Share → find NekoZeni</Check>
          <Check>NekoZeni opens with the image already attached — add a note and hit Send</Check>
        </ul>
        <Tip>If NekoZeni doesn&apos;t appear in the share sheet, open it once and sign in, then check again.</Tip>
      </div>
    ),
  },
];

export function GuidePageClient() {
  const { status } = useSession();
  const { locale } = useLocale();
  const [activeStep, setActiveStep] = useState(0);
  const backHref = status === "authenticated" ? "/" : "/login";
  const backLabel = status === "authenticated" ? "Back to chat" : "Back to sign in";

  const step = STEPS[activeStep];
  const Icon = step.icon;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-amber-50/60 to-background pb-16 dark:from-amber-950/15">
      <div className="mx-auto max-w-xl px-4 pt-6">
        {/* Back link */}
        <div className="mb-5">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" asChild>
            <Link href={backHref}>
              <ChevronLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
        </div>

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">How to use NekoZeni</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Step {activeStep + 1} of {STEPS.length}
          </p>
        </div>

        {/* Step pills / progress */}
        <div className="mb-6 flex items-center gap-1.5 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const SIcon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveStep(i)}
                title={s.title}
                aria-label={s.title}
                aria-pressed={i === activeStep}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-medium transition-all",
                  i === activeStep
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : i < activeStep
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                <SIcon className="h-4 w-4" />
                <span className="hidden sm:inline leading-none">{s.title.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Active step card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {/* Step header */}
            <div className="mb-3 flex items-center gap-3">
              <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border", step.color)}>
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">{step.title}</h2>
                <p className="text-xs text-muted-foreground">{step.subtitle}</p>
              </div>
            </div>

            <StepCard color={step.color}>
              {step.content}
            </StepCard>
          </motion.div>
        </AnimatePresence>

        {/* Prev / Next navigation */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={activeStep === 0}
            onClick={() => setActiveStep((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <span className="text-xs text-muted-foreground">
            {activeStep + 1} / {STEPS.length}
          </span>

          {activeStep < STEPS.length - 1 ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setActiveStep((i) => Math.min(STEPS.length - 1, i + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" asChild>
              <Link href={backHref}>
                <CheckCircle2 className="h-4 w-4" />
                Done
              </Link>
            </Button>
          )}
        </div>

        {/* Quick jump list on last step */}
        {activeStep === STEPS.length - 1 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-2xl border bg-card p-4"
          >
            <p className="mb-3 text-xs font-medium text-muted-foreground">Jump to any topic</p>
            <div className="grid grid-cols-2 gap-2">
              {STEPS.map((s, i) => {
                const SIcon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveStep(i)}
                    className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/60"
                  >
                    <SIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    {s.title}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
