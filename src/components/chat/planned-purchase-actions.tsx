"use client";

import { useState, useTransition } from "react";

import { convertPlanToTransactionAction, deleteFinancialPlanAction } from "@/actions/financial-plans";
import { Button } from "@/components/ui/button";
import type { PlanChatAction } from "@/types/chat";

export function PlannedPurchaseNotice({
  plan,
  onResolved,
}: {
  plan: PlanChatAction;
  onResolved: (note: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-medium">Saved as a planned purchase (not a transaction).</p>
      <p className="mt-1 text-[11px] opacity-80">{plan.title}</p>
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(() => {
              void (async () => {
                const result = await convertPlanToTransactionAction(plan.planId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                onResolved("Moved onto your transactions as a purchase.");
              })();
            });
          }}
        >
          I already bought it
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(() => {
              void (async () => {
                const result = await deleteFinancialPlanAction(plan.planId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                onResolved("Removed that planned purchase.");
              })();
            });
          }}
        >
          Undo
        </Button>
      </div>
    </div>
  );
}

export function PlanMatchActions({
  plans,
  onResolved,
}: {
  plans: PlanChatAction[];
  onResolved: (planId: string, note: string) => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (plans.length === 0) return null;

  return (
    <div className="space-y-2">
      {plans.map((plan) => (
        <div key={plan.planId} className="rounded-xl border bg-card px-3 py-2 text-xs">
          <div className="font-medium text-foreground">{plan.title}</div>
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              disabled={pendingId !== null}
              onClick={() => {
                setError(null);
                setPendingId(plan.planId);
                void (async () => {
                  const result = await convertPlanToTransactionAction(plan.planId);
                  setPendingId(null);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  onResolved(plan.planId, "Marked as bought and added to your transactions.");
                })();
              }}
            >
              {pendingId === plan.planId ? "Saving…" : "Mark as bought"}
            </Button>
          </div>
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
