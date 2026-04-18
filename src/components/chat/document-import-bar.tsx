"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { persistReceiptSplitAction, resolveDocumentImportAction } from "@/actions/document-import";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingDocumentImport, ReceiptSplitItem } from "@/types/chat";

type Props = {
  pending: PendingDocumentImport;
  onResolved: (message: string) => void;
  onDismiss: () => void;
};

function SplitReview({
  items,
  chatTurnId,
  onResolved,
  onDismiss,
}: {
  items: ReceiptSplitItem[];
  chatTurnId: string;
  onResolved: (msg: string) => void;
  onDismiss: () => void;
}) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, field: keyof ReceiptSplitItem, value: string | number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await persistReceiptSplitAction(chatTurnId, rows);
      if (r.ok) {
        onResolved(r.message);
        onDismiss();
      } else {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-amber-950 dark:text-amber-50">
        This bill spans multiple categories — review and confirm each split:
      </p>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5 rounded-lg border bg-white/60 px-2 py-1.5 text-xs dark:bg-background/40">
            <span className="truncate font-medium text-foreground">{row.description}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={row.amount}
              onChange={(e) => updateRow(i, "amount", parseFloat(e.target.value) || 0)}
              className="w-20 rounded border bg-background px-1.5 py-0.5 text-right text-xs"
            />
            <input
              value={row.category}
              onChange={(e) => updateRow(i, "category", e.target.value)}
              className="w-24 rounded border bg-background px-1.5 py-0.5 text-xs"
              placeholder="Category"
            />
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Confirm &amp; save all
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={onDismiss}>
          Later
        </Button>
      </div>
    </div>
  );
}

export function DocumentImportBar({ pending, onResolved, onDismiss }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: "add" | "edit") => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("chatTurnId", pending.chatTurnId);
      fd.set("mode", mode);
      if (mode === "edit") {
        fd.set("correctionText", correctionText.trim());
      }
      const r = await resolveDocumentImportAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onResolved(r.message);
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  // If AI proposed a category split, show the split review UI
  if (pending.splitItems && pending.splitItems.length > 0) {
    return (
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/35">
        <SplitReview
          items={pending.splitItems}
          chatTurnId={pending.chatTurnId}
          onResolved={onResolved}
          onDismiss={onDismiss}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/35">
      <p className="text-xs font-medium text-amber-950 dark:text-amber-50">
        Receipt / payroll document ready — save to your ledger?
      </p>
      <p className="mt-1 text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/85">
        {pending.documentKind === "receipt" ? "Receipt" : "Payroll"} · confirm below or describe corrections.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {!editOpen ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={() => void run("add")}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save as read
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => setEditOpen(true)}
          >
            Edit first
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={onDismiss}>
            Later
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Textarea
            value={correctionText}
            onChange={(e) => setCorrectionText(e.target.value)}
            placeholder="e.g. Total was 47.82 not 48. Merchant is FreshCo."
            className="min-h-[72px] text-xs"
            rows={3}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={busy || !correctionText.trim()}
              onClick={() => void run("edit")}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Apply edit & save
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => setEditOpen(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
