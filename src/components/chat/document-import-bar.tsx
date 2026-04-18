"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { resolveDocumentImportAction } from "@/actions/document-import";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingDocumentImport } from "@/types/chat";

type Props = {
  pending: PendingDocumentImport;
  onResolved: (message: string) => void;
  onDismiss: () => void;
};

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

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/35">
      <p className="text-xs font-medium text-amber-950 dark:text-amber-50">
        Receipt / paystub ready — save to your ledger?
      </p>
      <p className="mt-1 text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/85">
        {pending.documentKind === "receipt" ? "Receipt" : "Paystub"} · confirm below or describe corrections.
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
