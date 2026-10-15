import type { PrismaClient } from "@prisma/client";

import { localCalendarYmd } from "@/lib/date/local-ymd";
import {
  hasExplicitPlanIntent,
  looksLikeCompletedPurchase,
  looksLikeLedgerLookup,
} from "@/lib/finance/ledger-query";
import { persistFreeformLedgerEntry } from "@/lib/finance/persist-from-chat";

export type PlanSuggestionInput = {
  title: string;
  description?: string | null;
  amountCents?: number | null;
  /** Major currency units, used when amountCents is missing. */
  amount?: number | null;
  currency?: string | null;
  kind?: "spending_budget" | "savings_goal" | null;
};

export type PlanSuggestionDecision =
  | { kind: "ignore_lookup" }
  | { kind: "create_plan" }
  | {
      kind: "transaction_draft";
      amountCents: number;
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

const ASK_PRICE = "What price did you pay?";

const ASK_INTENT = "Did you already buy this, or are you planning to?";

export function merchantFromPlanTitle(title: string): string {
  const stripped = title.replace(/^\s*buy\s+/i, "").trim();
  return stripped.length > 0 ? stripped : title.trim();
}

function amountCentsFromMessage(message: string): number | null {
  const dollar = message.match(/(?:\$|cad|usd)\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (dollar) {
    const major = Number.parseFloat(dollar[1].replace(",", ""));
    if (Number.isFinite(major) && major > 0) return Math.round(major * 100);
  }
  const forAmount = message.match(/\bfor\s+(\d+(?:[.,]\d{1,2})?)\b/i);
  if (forAmount) {
    const major = Number.parseFloat(forAmount[1].replace(",", ""));
    if (Number.isFinite(major) && major > 0) return Math.round(major * 100);
  }
  return null;
}

export function resolveSuggestionAmountCents(message: string, suggestion: PlanSuggestionInput): number | null {
  if (typeof suggestion.amountCents === "number" && Number.isFinite(suggestion.amountCents) && suggestion.amountCents > 0) {
    return Math.round(suggestion.amountCents);
  }
  if (typeof suggestion.amount === "number" && Number.isFinite(suggestion.amount) && suggestion.amount > 0) {
    return Math.round(suggestion.amount * 100);
  }
  return amountCentsFromMessage(message);
}

function occurredOnFromMessage(message: string): string {
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const text = message.toLowerCase();
  if (/\byesterday\b/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localCalendarYmd(d);
  }
  return localCalendarYmd(new Date());
}

/** Decide what a model planSuggestion is allowed to do for this user message. */
export function decidePlanSuggestion(message: string, suggestion: PlanSuggestionInput): PlanSuggestionDecision {
  if (looksLikeLedgerLookup(message)) return { kind: "ignore_lookup" };

  const currency = (suggestion.currency ?? "CAD").toUpperCase().slice(0, 3) || "CAD";
  const amountCents = resolveSuggestionAmountCents(message, suggestion);

  if (looksLikeCompletedPurchase(message)) {
    if (amountCents == null) {
      return { kind: "ask_price", followUpQuestion: ASK_PRICE };
    }
    return {
      kind: "transaction_draft",
      amountCents,
      merchant: merchantFromPlanTitle(suggestion.title),
      memo: suggestion.description?.trim() || suggestion.title.trim() || null,
      currency,
      occurredOn: occurredOnFromMessage(message),
      confirmReason: BOUGHT_INSTEAD_OF_PLAN,
    };
  }

  if (hasExplicitPlanIntent(message)) {
    return { kind: "create_plan" };
  }

  return { kind: "ask_intent", followUpQuestion: ASK_INTENT };
}

export type AppliedPlanSuggestion =
  | {
      outcome: "plan";
      planId: string;
      title: string;
      amountCents: number | null;
      currency: string;
    }
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
        amount: decision.amountCents / 100,
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

  const amountCents = resolveSuggestionAmountCents(message, suggestion);
  const currency = (suggestion.currency ?? "CAD").toUpperCase().slice(0, 3) || "CAD";
  const maxSort = await db.financialPlan.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });
  const created = await db.financialPlan.create({
    data: {
      userId,
      kind: suggestion.kind === "savings_goal" ? "savings_goal" : "spending_budget",
      title: title.slice(0, 200),
      description: suggestion.description?.trim() ? suggestion.description.trim().slice(0, 2000) : null,
      amountCents,
      currency,
      period: "none",
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
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
