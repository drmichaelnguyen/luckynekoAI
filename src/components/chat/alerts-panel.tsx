"use client";

import { Bell, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  confirmAllPendingAsOneTimeAction,
  listPendingTransactionsAction,
} from "@/actions/finance";
import {
  PendingConfirmRow,
  type PendingConfirmItem,
} from "@/components/chat/pending-confirm-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AlertsPanel({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState<PendingConfirmItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    setLoading(true);
    void listPendingTransactionsAction().then((r) => {
      if (r.ok) setPending(r.rows);
      else setPending([]);
      setLoading(false);
      onChanged?.();
    });
  }, [onChanged]);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-black/50"
        aria-label="Close alerts"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-xl flex-col rounded-t-2xl border bg-background shadow-2xl",
          "max-h-[min(85dvh,640px)]",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alerts-panel-title"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <h2 id="alerts-panel-title" className="text-sm font-semibold">
                Alerts
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Transactions waiting for your confirm
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close alerts">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading alerts…
            </div>
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Bell className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">You&apos;re all caught up</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                When NekoZeni is unsure about a bill, subscription, or loan, it will ask you here to confirm
                one-time vs recurring.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {pending.length} waiting for your decision
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => {
                      void (async () => {
                        await confirmAllPendingAsOneTimeAction();
                        refresh();
                      })();
                    });
                  }}
                >
                  Confirm all as one-time
                </Button>
              </div>
              <ul className="space-y-3">
              {pending.map((item) => (
                <PendingConfirmRow
                  key={item.id}
                  item={item}
                  isPending={isPending}
                  onRefresh={refresh}
                  startTransition={startTransition}
                />
              ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
