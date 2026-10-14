"use client";

import { CalendarDays, ChevronRight, FolderTree, Loader2, Search, Tags, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { searchTransactionsGroupedAction } from "@/actions/finance";
import type { LedgerSearchRow, WalletTransactionGroup } from "@/lib/finance/ledger-query";
import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import { TransactionDetailDrawer } from "@/components/chat/transaction-detail-drawer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function monthName(monthIndex: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[monthIndex] ?? String(monthIndex + 1);
}

function sortCurrencies(a: string, b: string, displayCurrency: string) {
  if (a === displayCurrency && b !== displayCurrency) return -1;
  if (b === displayCurrency && a !== displayCurrency) return 1;
  return a.localeCompare(b);
}

function formatTotals(
  transactions: LedgerSearchRow[],
  direction: "in" | "out",
  displayCurrency: string,
): string | null {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.direction !== direction) continue;
    const currency = (tx.currency || displayCurrency).toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + tx.amountCents);
  }
  if (totals.size === 0) return null;
  return [...totals.entries()]
    .sort(([a], [b]) => sortCurrencies(a, b, displayCurrency))
    .map(([currency, cents]) => formatMoney(cents, currency))
    .join(" / ");
}

type CategoryNode = {
  name: string;
  transactions: LedgerSearchRow[];
};

type MonthNode = {
  key: string;
  label: string;
  transactions: LedgerSearchRow[];
  categories: CategoryNode[];
};

type YearNode = {
  year: string;
  transactions: LedgerSearchRow[];
  months: MonthNode[];
};

type WalletTreeGroup = WalletTransactionGroup & {
  years: YearNode[];
};

function buildTransactionTree(groups: WalletTransactionGroup[]): WalletTreeGroup[] {
  return groups.map((group) => {
    const yearMap = new Map<string, {
      transactions: LedgerSearchRow[];
      monthMap: Map<string, {
        label: string;
        transactions: LedgerSearchRow[];
        categoryMap: Map<string, LedgerSearchRow[]>;
      }>;
    }>();

    for (const tx of group.transactions) {
      const d = new Date(tx.occurredAt);
      const year = Number.isNaN(d.getTime()) ? "Unknown year" : String(d.getFullYear());
      const monthKey = Number.isNaN(d.getTime()) ? "unknown" : `${year}-${pad2(d.getMonth() + 1)}`;
      const monthLabel = Number.isNaN(d.getTime()) ? "Unknown month" : `${monthName(d.getMonth())} ${year}`;
      const categoryName = tx.categoryName || "Uncategorized";

      let yearNode = yearMap.get(year);
      if (!yearNode) {
        yearNode = { transactions: [], monthMap: new Map() };
        yearMap.set(year, yearNode);
      }
      yearNode.transactions.push(tx);

      let monthNode = yearNode.monthMap.get(monthKey);
      if (!monthNode) {
        monthNode = { label: monthLabel, transactions: [], categoryMap: new Map() };
        yearNode.monthMap.set(monthKey, monthNode);
      }
      monthNode.transactions.push(tx);

      const categoryRows = monthNode.categoryMap.get(categoryName) ?? [];
      categoryRows.push(tx);
      monthNode.categoryMap.set(categoryName, categoryRows);
    }

    const years = [...yearMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, yearNode]) => ({
        year,
        transactions: yearNode.transactions,
        months: [...yearNode.monthMap.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([key, monthNode]) => ({
            key,
            label: monthNode.label,
            transactions: monthNode.transactions,
            categories: [...monthNode.categoryMap.entries()]
              .map(([name, transactions]) => ({ name, transactions }))
              .sort((a, b) => b.transactions.length - a.transactions.length || a.name.localeCompare(b.name)),
          })),
      }));

    return { ...group, years };
  });
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
    <button
      type="button"
      className="flex min-h-14 w-full flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition hover:bg-muted/50 active:scale-[0.99]"
      onClick={() => onSelect(tx.id)}
      aria-label={`View transaction: ${label}`}
    >
      <div className="flex items-start justify-between gap-3 text-xs">
        <span className={cn("font-semibold", tx.direction === "out" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
          {tx.direction === "out" ? "-" : "+"}
          {formatMoney(tx.amountCents, tx.currency || currency)}
        </span>
        <span className="shrink-0 text-muted-foreground">{tx.occurredAt.slice(0, 10)}</span>
      </div>
      <div className="truncate text-xs font-medium text-foreground">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{tx.categoryName}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Edit
        </span>
      </div>
    </button>
  );
}

function SummaryLine({
  transactions,
  displayCurrency,
}: {
  transactions: LedgerSearchRow[];
  displayCurrency: string;
}) {
  const out = formatTotals(transactions, "out", displayCurrency);
  const incoming = formatTotals(transactions, "in", displayCurrency);
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums sm:justify-end">
      {out ? <span className="text-red-600 dark:text-red-400">-{out}</span> : null}
      {incoming ? <span className="text-emerald-600 dark:text-emerald-400">+{incoming}</span> : null}
    </span>
  );
}

function TreeSummary({
  icon,
  title,
  count,
  transactions,
  displayCurrency,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  transactions: LedgerSearchRow[];
  displayCurrency: string;
}) {
  return (
    <summary className="flex min-h-12 cursor-pointer list-none flex-col gap-1 rounded-xl px-3 py-2.5 transition hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-open:rotate-90" />
        <span className="hidden shrink-0 text-primary sm:inline-flex">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground">{title}</span>
          <span className="block text-[10px] text-muted-foreground">
            {count} transaction{count === 1 ? "" : "s"}
          </span>
        </span>
      </div>
      <div className="pl-5 sm:pl-0">
        <SummaryLine transactions={transactions} displayCurrency={displayCurrency} />
      </div>
    </summary>
  );
}

export function ToolsTransactionsTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [groups, setGroups] = useState<WalletTransactionGroup[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [displayCurrency, setDisplayCurrency] = useState("CAD");
  const [error, setError] = useState<string | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  const treeGroups = useMemo(() => buildTransactionTree(groups), [groups]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback((query: string) => {
    startTransition(async () => {
      setError(null);
      const r = await searchTransactionsGroupedAction(query || undefined);
      if (!r.ok) {
        setError(r.error);
        setGroups([]);
        setTotalCount(0);
        return;
      }
      setGroups(r.groups);
      setTotalCount(r.totalCount);
      setDisplayCurrency(r.displayCurrency);
    });
  }, []);

  useEffect(() => {
    load(debouncedSearch);
  }, [debouncedSearch, load]);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 className="text-sm font-semibold">Transaction details</h3>
        <p className="text-xs text-muted-foreground">
          Wallet → year → month → category. Tap a row to view and edit.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant, memo, wallet…"
            className="h-11 rounded-xl pl-8 text-base sm:h-10 sm:text-sm"
            aria-label="Search transactions"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {totalCount} transaction{totalCount === 1 ? "" : "s"}
          {debouncedSearch ? ` matching “${debouncedSearch}”` : ""}
        </span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && groups.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          {debouncedSearch ? "No transactions match your search." : "No transactions in your ledger yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {treeGroups.map((group) => {
            const walletOut = formatTotals(group.transactions, "out", displayCurrency);
            const walletIn = formatTotals(group.transactions, "in", displayCurrency);
            return (
            <section key={group.walletId} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex items-start justify-between gap-3 border-b bg-muted/25 px-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Wallet className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold">{group.walletName}</h4>
                    <p className="text-[10px] text-muted-foreground">
                      {group.transactions.length} row{group.transactions.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10px] tabular-nums">
                  {walletOut ? (
                    <div className="text-red-600 dark:text-red-400">
                      -{walletOut}
                    </div>
                  ) : null}
                  {walletIn ? (
                    <div className="text-emerald-600 dark:text-emerald-400">
                      +{walletIn}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5 p-2">
                {group.years.map((year) => (
                  <details key={year.year} className="group rounded-xl bg-background/70" open={Boolean(debouncedSearch)}>
                    <TreeSummary
                      icon={<CalendarDays className="h-3.5 w-3.5" />}
                      title={year.year}
                      count={year.transactions.length}
                      transactions={year.transactions}
                      displayCurrency={displayCurrency}
                    />
                    <div className="ml-3 space-y-1.5 border-l pb-2 pl-2">
                      {year.months.map((month) => (
                        <details key={month.key} className="group rounded-xl bg-muted/20" open={Boolean(debouncedSearch)}>
                          <TreeSummary
                            icon={<FolderTree className="h-3.5 w-3.5" />}
                            title={month.label}
                            count={month.transactions.length}
                            transactions={month.transactions}
                            displayCurrency={displayCurrency}
                          />
                          <div className="ml-3 space-y-1.5 border-l pb-2 pl-2">
                            {month.categories.map((category) => (
                              <details key={category.name} className="group rounded-xl bg-background" open={Boolean(debouncedSearch)}>
                                <TreeSummary
                                  icon={<Tags className="h-3.5 w-3.5" />}
                                  title={category.name}
                                  count={category.transactions.length}
                                  transactions={category.transactions}
                                  displayCurrency={displayCurrency}
                                />
                                <div className="space-y-2 pb-2 pl-5 pr-1">
                                  {category.transactions.map((tx) => (
                                    <TransactionRow
                                      key={tx.id}
                                      tx={tx}
                                      currency={displayCurrency}
                                      onSelect={setSelectedTxId}
                                    />
                                  ))}
                                </div>
                              </details>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          );
          })}
        </div>
      )}

      <TransactionDetailDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onSaved={() => load(debouncedSearch)}
      />
    </div>
  );
}
