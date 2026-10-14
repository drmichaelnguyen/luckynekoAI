"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import type { LedgerCurrencyTotal, LedgerSearchRow } from "@/lib/finance/ledger-query";
import { TransactionDetailDrawer } from "@/components/chat/transaction-detail-drawer";
import { cn } from "@/lib/utils";

export type ChatLedgerQueryStructured = {
  documentKind: "ledger_query";
  ledgerQuery: {
    scopeLabel: string;
    txCount: number;
    totalCents: number;
    totalsByCurrency?: LedgerCurrencyTotal[];
    displayCurrency: string;
    questionKind: "amount" | "temporal" | "browse";
    transactions: LedgerSearchRow[];
  };
};

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

function formatTotals(data: ChatLedgerQueryStructured["ledgerQuery"]): string {
  if (!data.totalsByCurrency || data.totalsByCurrency.length === 0) {
    return formatMoney(data.totalCents, data.displayCurrency);
  }
  return data.totalsByCurrency.map((row) => formatMoney(row.cents, row.currency)).join(" and ");
}

function TransactionRow({
  tx,
  currency,
  onSelect,
}: {
  tx: LedgerSearchRow;
  currency: string;
  onSelect: (id: string) => void;
}) {
  const label = tx.merchant ?? tx.memo ?? "Transaction";
  return (
    <li
      className="flex cursor-pointer flex-col gap-0.5 rounded-md border bg-muted/20 px-2 py-1.5 transition hover:bg-muted/50 active:scale-[0.99]"
      onClick={() => onSelect(tx.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(tx.id);
      }}
      aria-label={`View transaction: ${label}`}
    >
      <div className="flex justify-between gap-2">
        <span className="font-medium text-foreground">
          {tx.direction === "out" ? "Out" : "In"} · {formatMoney(tx.amountCents, tx.currency || currency)}
        </span>
        <span className="shrink-0 text-muted-foreground">{tx.occurredAt.slice(0, 10)}</span>
      </div>
      <div className="text-muted-foreground">
        {tx.walletName} · {tx.categoryName}
      </div>
      <div className="truncate text-muted-foreground">{label}</div>
    </li>
  );
}

export function LedgerSearchResults({ data }: { data: ChatLedgerQueryStructured["ledgerQuery"] }) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const currency = data.displayCurrency;

  return (
    <>
      <div className="mt-2 rounded-xl border bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">
              {data.txCount} match{data.txCount === 1 ? "" : "es"} · {data.scopeLabel}
            </div>
            {data.questionKind === "amount" && data.txCount > 0 ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Total: {formatTotals(data)}
              </div>
            ) : null}
          </div>
        </div>

        {data.transactions.length > 0 ? (
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-[11px]">
            {data.transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                currency={currency}
                onSelect={setSelectedTxId}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">No matching transactions to show.</p>
        )}

        {data.txCount > data.transactions.length ? (
          <p className={cn("mt-2 text-[10px] text-muted-foreground")}>
            Showing {data.transactions.length} of {data.txCount}. Open Tools → Transactions to browse more.
          </p>
        ) : null}
      </div>

      <TransactionDetailDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
      />
    </>
  );
}
