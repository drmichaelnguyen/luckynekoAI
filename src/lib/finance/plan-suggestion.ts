import type { PrismaClient } from "@prisma/client";

import { amountCentsToMajor } from "@/lib/finance/amount-cents";
import { localCalendarYmd } from "@/lib/date/local-ymd";
import {
  hasExplicitPlanIntent,
  looksLikeCompletedPurchase,
  looksLikeLedgerLookupRequest,
} from "@/lib/finance/ledger-query";
import { persistFreeformLedgerEntry } from "@/lib/finance/persist-from-chat";

export type PlanSuggestionInput = {
  title: string;
  description?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  period?: "none" | "weekly" | "monthly" | "yearly" | null;
  targetDate?: string | null;
};

export type PlanSuggestionDecision =
  | { kind: "ignore_lookup" }
  | { kind: "create_plan" }
  | {
      kind: "transaction_draft";
      amountMajor: number;
      merchant: string;
      memo: string | null;
      currency: string;
      occurredOn: string;
      confirmReason: string;
    }
  | { kind: "ask_price"; followUpQuestion: string }
  | { kind: "ask_intent"; followUpQuestion: string };

const BOUGHT_INSTEAD_OF_PLAN =
  "You said you bought this, so I saved it as a purchase instead of a plan. Please confirm.";

export function merchantFromPlanTitle(title: string): string {
  const stripped = title.replace(/^\s*buy\s+/i, "").trim();
  return stripped.length > 0 ? stripped : title.trim();
}

function amountCentsFromMessage(message: string): number | null {
  const dollar = message.match(/(?:\$|cad|usd)\s*(\d+(?:[.,]\d{1,2})?)/i);
  const forAmount = message.match(/\bfor\s+(\d+(?:[.,]\d{1,2})?)\b/i);
  const raw = dollar?.[1] ?? forAmount?.[1];
  if (!raw) return null;
  const major = Number.parseFloat(raw.replace(",", ""));
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 100);
}

function occurredOnFromMessage(message: string): string {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\byesterday\b/i.test(message)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localCalendarYmd(d);
  }
  return localCalendarYmd(new Date());
}

export function decidePlanSuggestion(message: string, suggestion: PlanSuggestionInput): PlanSuggestionDecision {
  if (looksLikeLedgerLookupRequest(message)) return { kind: "ignore_lookup" };
  const currency = (suggestion.currency ?? "CAD").toUpperCase().slice(0, 3) || "CAD";
  const amountCents =
    typeof suggestion.amountCents === "number" && suggestion.amountCents > 0
      ? Math.round(suggestion.amountCents)
      : amountCentsFromMessage(message);

  if (looksLikeCompletedPurchase(message)) {
    if (amountCents == null) return { kind: "ask_price", followUpQuestion: "What price did you pay?" };
    return {
      kind: "transaction_draft",
      amountMajor: amountCentsToMajor(amountCents, currency),
      merchant: merchantFromPlanTitle(suggestion.title),
      memo: suggestion.description?.trim() || suggestion.title.trim() || null,
      currency,
      occurredOn: occurredOnFromMessage(message),
      confirmReason: BOUGHT_INSTEAD_OF_PLAN,
    };
  }

  if (hasExplicitPlanIntent(message)) return { kind: "create_plan" };
  return { kind: "ask_intent", followUpQuestion: "Did you already buy this, or are you planning to?" };
}

export type AppliedPlanSuggestion =
  | { outcome: "plan"; planId: string; title: string; amountCents: number | null; currency: string }
  | { outcome: "draft"; transactionId: string; detail: string }
  | { outcome: "follow_up"; followUpQuestion: string }
  | { outcome: "ignored" }
  | { outcome: "error"; error: string };

export async function applyPlanSuggestion(
  db: PrismaClient,
  userId: string,
  message: string,
  suggestion: PlanSuggestionInput,
): Promise<AppliedPlanSuggestion> {
  const title = suggestion.title.trim();
  if (!title) return { outcome: "error", error: "Plan title is empty." };
  const decision = decidePlanSuggestion(message, { ...suggestion, title });
  if (decision.kind === "ignore_lookup") return { outcome: "ignored" };
  if (decision.kind === "ask_price" || decision.kind === "ask_intent") {
    return { outcome: "follow_up", followUpQuestion: decision.followUpQuestion };
  }

  if (decision.kind === "transaction_draft") {
    const persisted = await persistFreeformLedgerEntry(
      db,
      userId,
      {
        amount: decision.amountMajor,
        currency: decision.currency,
        merchant: decision.merchant,
        notes: decision.memo,
        direction: "out",
        recurrence: "one_time",
        needsUserConfirm: true,
        userConfirmReason: decision.confirmReason,
        transactionDate: decision.occurredOn,
        category: "Other",
      },
      JSON.stringify({ source: "plan_suggestion_guard", suggestion }),
    );
    if (!persisted.saved || !persisted.transactionId) {
      return { outcome: "error", error: persisted.detail || "Could not save the purchase." };
    }
    return { outcome: "draft", transactionId: persisted.transactionId, detail: persisted.detail };
  }

  const amountCents =
    typeof suggestion.amountCents === "number" && suggestion.amountCents > 0
      ? Math.round(suggestion.amountCents)
      : amountCentsFromMessage(message);
  const currency = (suggestion.currency ?? "CAD").toUpperCase().slice(0, 3) || "CAD";
  const created = await db.financialPlan.create({
    data: {
      userId,
      kind: "spending_budget",
      title: title.slice(0, 200),
      description: suggestion.description?.trim() ? suggestion.description.trim().slice(0, 2000) : null,
      amountCents,
      currency,
      period: suggestion.period ?? "none",
      targetDate: suggestion.targetDate ? new Date(suggestion.targetDate) : null,
      sortOrder: 0,
    },
  });
  return {
    outcome: "plan",
    planId: created.id,
    title: created.title,
    amountCents: created.amountCents,
    currency: created.currency,
  };
}
