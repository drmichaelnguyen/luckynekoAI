"use client";

import { useState, useTransition } from "react";

import { convertPlanToTransactionAction } from "@/actions/financial-plans";
import { searchTransactionsAction } from "@/actions/ledger-search";
import type { LedgerPlanHit, LedgerTransactionHit } from "@/lib/finance/ledger-query";
import { formatPlannedPurchaseFallback } from "@/lib/finance/ledger-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function money(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export function ToolsTransactionsTab() {
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionHit[]>([]);
  const [plans, setPlans] = useState<LedgerPlanHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch(text: string) {
    setError(null);
    startTransition(() => {
      void (async () => {
        const result = await searchTransactionsAction(text);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setTerms(result.terms);
        setTransactions(result.transactions);
        setPlans(result.plans);
        setSearched(true);
      })();
    });
  }

  const fallback = searched && transactions.length === 0 ? formatPlannedPurchaseFallback(plans) : null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Search payees, notes, and categories. Words like “bought” are ignored, so “I bought a Nikon lens 85mm” still
        finds the lens. Planned purchases show up here when they are not in your transactions yet.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. nikon lens 85mm"
          className="text-sm"
          aria-label="Search transactions"
        />
        <Button type="submit" size="sm" className="h-11 sm:h-9" disabled={pending || !query.trim()}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {searched && terms.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">Matching {terms.join(", ")}</p>
      ) : null}
      {searched && transactions.length === 0 && !fallback ? (
        <p className="text-xs text-muted-foreground">No transactions match.</p>
      ) : null}
      {transactions.length > 0 ? (
        <ul className="space-y-2">
          {transactions.map((row) => (
            <li key={row.id} className="rounded-lg border bg-card px-3 py-2 text-xs">
              <div className="font-medium text-foreground">
                {row.merchant || row.memo || "Transaction"} · {money(row.amountCents, row.currency)}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {row.occurredAt.slice(0, 10)} · {row.walletName} · {row.categoryName}
                {row.status === "pending_user" ? " · needs confirm" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {fallback ? <p className="text-xs text-foreground">{fallback}</p> : null}
      {searched && transactions.length === 0 && plans.length > 0 ? (
        <ul className="space-y-2">
          {plans.map((plan) => (
            <li key={plan.id} className="rounded-lg border bg-card px-3 py-2 text-xs">
              <div className="font-medium">{plan.title}</div>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || plan.amountCents == null}
                  onClick={() => {
                    startTransition(() => {
                      void (async () => {
                        const result = await convertPlanToTransactionAction(plan.id);
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        runSearch(query);
                      })();
                    });
                  }}
                >
                  Mark as bought
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
