"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import {
  getTransactionDetailAction,
  updateTransactionAction,
  type EditableFields,
  type TransactionDetail,
} from "@/actions/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

function formatMoney(cents: number, currency: string) {
  return `${currency} ${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function TransactionDetailDrawer({
  transactionId,
  onClose,
  onSaved,
}: {
  transactionId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<{
    tx: TransactionDetail;
    wallets: { id: string; name: string }[];
    categories: { id: string; name: string; kind: string; parentId: string | null; parentName: string | null }[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Edit form state
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [occurredAt, setOccurredAt] = useState("");
  const [memo, setMemo] = useState("");
  const [walletId, setWalletId] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  useEffect(() => {
    if (!transactionId) { setData(null); return; }
    setData(null);
    setLoadError(null);
    setSaveMsg(null);
    setShowHistory(false);
    startLoad(async () => {
      const r = await getTransactionDetailAction(transactionId);
      if (!r.ok) { setLoadError(r.error); return; }
      setData(r);
      const { tx } = r;
      setMerchant(tx.merchant ?? "");
      setAmount(String(Math.abs(tx.amountCents) / 100));
      setCurrency(tx.currency);
      setDirection(tx.direction);
      setOccurredAt(formatDate(tx.occurredAt));
      setMemo(tx.memo ?? "");
      setWalletId(tx.walletId);
      setCategoryId(tx.categoryId ?? "");
    });
  }, [transactionId]);

  function handleSave() {
    if (!data) return;
    const amountNum = parseFloat(amount);
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      setSaveMsg({ text: "Invalid amount", ok: false });
      return;
    }
    const fields: EditableFields = {
      amountCents: Math.round(amountNum * 100),
      direction,
      currency: currency.toUpperCase(),
      merchant: merchant.trim() || null,
      memo: memo.trim() || null,
      occurredAt: `${occurredAt}T12:00:00`,
      walletId,
      categoryId: categoryId || null,
    };
    startSave(async () => {
      const r = await updateTransactionAction(data.tx.id, fields);
      if (r.ok) {
        setSaveMsg({ text: "Saved", ok: true });
        onSaved?.();
        // Reload to get updated history
        const refreshed = await getTransactionDetailAction(data.tx.id);
        if (refreshed.ok) {
          setData(refreshed);
        }
      } else {
        setSaveMsg({ text: r.error ?? "Failed to save", ok: false });
      }
    });
  }

  if (!transactionId) return null;

  const categoryGroups = data
    ? data.categories.reduce<Record<string, typeof data.categories>>((acc, category) => {
        const key = category.parentName ?? "Top level";
        if (!acc[key]) acc[key] = [];
        acc[key].push(category);
        return acc;
      }, {})
    : {};

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />

      {/* Panel */}
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Transaction detail</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : data ? (
            <div className="space-y-4">
              {/* Source badge */}
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border px-2 py-0.5">{data.tx.source}</span>
                <span className="rounded-full border px-2 py-0.5">{data.tx.status}</span>
                {data.tx.editHistory.length > 0 && (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    {data.tx.editHistory.length} edit{data.tx.editHistory.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Edit form */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Amount</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Currency</span>
                    <Input
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                      className="h-8 text-sm"
                      maxLength={3}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Direction</span>
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as "in" | "out")}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="out">Out (expense)</option>
                      <option value="in">In (income)</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Date</span>
                    <Input
                      type="date"
                      value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Merchant</span>
                  <Input
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Merchant / payee"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Memo</span>
                  <Input
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Optional note"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Wallet</span>
                    <select
                      value={walletId}
                      onChange={(e) => setWalletId(e.target.value)}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {data.wallets.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Category</span>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— none —</option>
                      {Object.entries(categoryGroups).map(([group, categories]) => (
                        <optgroup key={group} label={group}>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.parentName ? c.name : `${c.name} (major)`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Edit history */}
              {data.tx.editHistory.length > 0 && (
                <div className="rounded-xl border bg-muted/30">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    Edit history ({data.tx.editHistory.length})
                    {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showHistory && (
                    <div className="space-y-2 border-t px-3 pb-3 pt-2">
                      {[...data.tx.editHistory].reverse().map((snap, i) => (
                        <div key={i} className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{snap.editedAt.slice(0, 16).replace("T", " ")}</span>
                          {Object.keys(snap.after).map((k) => (
                            <div key={k} className="ml-2">
                              <span className="text-foreground">{k}:</span>{" "}
                              <span className="line-through">{String((snap.before as Record<string, unknown>)[k] ?? "—")}</span>
                              {" → "}
                              <span className="text-foreground">{String((snap.after as Record<string, unknown>)[k] ?? "—")}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Raw AI extraction (collapsed) */}
              {data.tx.rawStructuredJson && (
                <details className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none text-foreground">Original AI extraction</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-snug">
                    {data.tx.rawStructuredJson}
                  </pre>
                </details>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {data && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            {saveMsg ? (
              <p className={cn("text-xs", saveMsg.ok ? "text-green-600" : "text-destructive")}>
                {saveMsg.text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Original: {formatMoney(data.tx.amountCents, data.tx.currency)} · {formatDate(data.tx.occurredAt)}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              disabled={isSaving || isLoading}
              onClick={handleSave}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
