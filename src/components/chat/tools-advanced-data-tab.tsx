"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  browseTransactionsAction,
  listCategoriesAction,
  listWalletsAction,
} from "@/actions/finance";
import type { TransactionBrowseRow } from "@/lib/finance/transaction-browser";
import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import { TransactionDetailDrawer } from "@/components/chat/transaction-detail-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SortKey = keyof Pick<
  TransactionBrowseRow,
  "occurredAt" | "merchant" | "memo" | "walletName" | "categoryName" | "direction" | "amountCents" | "status" | "source"
>;
type SortDir = "asc" | "desc";

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn("px-2 py-2 text-left font-medium", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

export function ToolsAdvancedDataTab({ active }: { active: boolean }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [walletId, setWalletId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [status, setStatus] = useState<"all" | "posted" | "pending_user">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState<TransactionBrowseRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("CAD");
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; parentName: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("occurredAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!active) return;
    void Promise.all([listWalletsAction(), listCategoriesAction()]).then(([w, c]) => {
      if (w.ok) setWallets(w.wallets.map((x) => ({ id: x.id, name: x.name })));
      if (c.ok) {
        setCategories(
          c.categories.map((x) => ({
            id: x.id,
            name: x.name,
            parentName: x.parentName,
          })),
        );
      }
    });
  }, [active]);

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      const r = await browseTransactionsAction({
        searchText: debouncedSearch || undefined,
        walletId: walletId || undefined,
        categoryId: categoryId || undefined,
        direction,
        status,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: 1000,
      });
      if (!r.ok) {
        setError(r.error);
        setRows([]);
        setTotalCount(0);
        return;
      }
      setRows(r.rows);
      setTotalCount(r.totalCount);
      setTruncated(r.truncated);
      setDisplayCurrency(r.displayCurrency);
    });
  }, [debouncedSearch, walletId, categoryId, direction, status, fromDate, toDate]);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "occurredAt" || key === "amountCents" ? "desc" : "asc");
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (sortKey === "amountCents") cmp = a.amountCents - b.amountCents;
      else if (sortKey === "occurredAt") cmp = a.occurredAt.localeCompare(b.occurredAt);
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  if (!active) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Advanced data view</h3>
          <p className="text-xs text-muted-foreground">
            Raw ledger rows in a sortable table. Search and filter, then tap a row to edit.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchant, memo, category, wallet…"
          className="pl-8 text-sm"
          aria-label="Search transactions"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          Wallet
          <select
            value={walletId}
            onChange={(e) => setWalletId(e.target.value)}
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          >
            <option value="">All</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentName ? `${c.parentName} > ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          Direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          >
            <option value="all">All</option>
            <option value="out">Out</option>
            <option value="in">In</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          >
            <option value="all">All</option>
            <option value="posted">Posted</option>
            <option value="pending_user">Pending</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          From
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-xs" />
        </label>
        <label className="space-y-1 text-[10px] font-medium text-muted-foreground">
          To
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-xs" />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {totalCount} row{totalCount === 1 ? "" : "s"}
          {truncated ? " (showing first 1,000 — narrow filters)" : ""}
        </span>
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 border-b bg-muted/60 text-muted-foreground">
            <tr>
              <SortHeader label="Date" sortKey="occurredAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Merchant" sortKey="merchant" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Memo" sortKey="memo" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Wallet" sortKey="walletName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Category" sortKey="categoryName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Dir" sortKey="direction" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader
                label="Amount"
                sortKey="amountCents"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="text-right"
              />
              <SortHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Source" sortKey="source" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {!loading && sortedRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  No rows match your filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((tx) => (
                <tr
                  key={tx.id}
                  className="cursor-pointer border-b border-border/50 transition hover:bg-muted/40"
                  onClick={() => setSelectedTxId(tx.id)}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{tx.occurredAt.slice(0, 10)}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5">{tx.merchant ?? "—"}</td>
                  <td className="max-w-[140px] truncate px-2 py-1.5 text-muted-foreground">{tx.memo ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{tx.walletName}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground">{tx.categoryName}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-medium",
                        tx.direction === "in"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-red-500/10 text-red-700 dark:text-red-400",
                      )}
                    >
                      {tx.direction === "in" ? "In" : "Out"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums",
                      tx.direction === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                    )}
                  >
                    {tx.direction === "in" ? "+" : "−"}
                    {formatMoney(tx.amountCents, tx.currency || displayCurrency)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{tx.status}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{tx.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TransactionDetailDrawer
        transactionId={selectedTxId}
        onClose={() => setSelectedTxId(null)}
        onSaved={load}
      />
    </div>
  );
}
