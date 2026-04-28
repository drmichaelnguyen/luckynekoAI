"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { confirmLedgerEditAction } from "@/actions/finance";
import { Button } from "@/components/ui/button";
import type { PendingLedgerEdit } from "@/types/chat";

type Props = {
  pending: PendingLedgerEdit;
  onResolved: (message: string) => void;
  onDismiss: () => void;
};

function describeChange(pending: PendingLedgerEdit): string {
  const parts: string[] = [];
  if (pending.newCategory) parts.push(`category -> ${pending.newCategory}`);
  if (pending.newMerchant) parts.push(`merchant -> ${pending.newMerchant}`);
  if (pending.newMemo) parts.push(`memo update`);
  if (pending.newAmount !== null) parts.push(`amount -> ${pending.newAmount.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : "transaction details";
}

export function LedgerEditConfirmBar({ pending, onResolved, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmLedgerEditAction({
        merchantHint: pending.merchantHint,
        dateHint: pending.dateHint,
        newAmount: pending.newAmount,
        newMemo: pending.newMemo,
        newCategory: pending.newCategory,
        newMerchant: pending.newMerchant ?? null,
      });
      if (r.ok) {
        onResolved(r.message);
        onDismiss();
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/35">
      <p className="text-xs font-medium text-amber-950 dark:text-amber-50">
        Bulk edit review
      </p>
      <p className="mt-1 text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/85">
        This will change {pending.matchedCount} matching transaction{pending.matchedCount === 1 ? "" : "s"} for{" "}
        {pending.scopeLabel}. Check the change summary and click Proceed to continue.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/85">
        {describeChange(pending)}
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void proceed()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Proceed
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={onDismiss}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
