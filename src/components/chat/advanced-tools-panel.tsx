"use client";

import { Download, Loader2, PanelRightClose, Upload, User, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { importCsvWithLlmAction } from "@/actions/csv-import";
import type { DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";
import { getLedgerDashboardAction } from "@/actions/dashboard";
import {
  confirmTransactionAction,
  createWalletAction,
  listPendingTransactionsAction,
  listWalletsAction,
  rejectPendingTransactionAction,
} from "@/actions/finance";
import { DashboardInsights } from "@/components/chat/dashboard-insights";
import { ToolsPlansTab } from "@/components/chat/tools-plans-tab";
import { ToolsProfileTab } from "@/components/chat/tools-profile-tab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "import" | "confirm" | "wallets" | "plans" | "profile" | "backup";

const MAX_CSV_PREVIEW_ROWS = 80;

function formatMoney(cents: number, currency: string) {
  const v = (cents / 100).toFixed(2);
  return `${currency} ${v}`;
}

export function AdvancedToolsButton({
  pendingCount,
  onClick,
}: {
  pendingCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="relative shrink-0 gap-1.5 px-2 sm:px-3"
      onClick={onClick}
      aria-label="Advanced tools"
      title="Advanced tools"
    >
      <Wrench className="h-4 w-4" />
      <span className="hidden sm:inline">Tools</span>
      {pendingCount > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {pendingCount > 9 ? "9+" : pendingCount}
        </span>
      ) : null}
    </Button>
  );
}

export function AdvancedToolsPanel({
  open,
  onClose,
  onBooksChanged,
}: {
  open: boolean;
  onClose: () => void;
  onBooksChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("30d");
  const [dashboardData, setDashboardData] = useState<Extract<LedgerDashboardResult, { ok: true }> | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [wallets, setWallets] = useState<{ id: string; name: string; kind: string; isDefault: boolean }[]>([]);
  const [pending, setPending] = useState<
    Array<{
      id: string;
      amountCents: number;
      direction: string;
      currency: string;
      merchant: string | null;
      memo: string | null;
      occurredAt: string;
      recurrence: string;
      confirmReason: string | null;
      walletName: string;
      categoryName: string;
    }>
  >([]);
  const [walletName, setWalletName] = useState("");
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const refresh = useCallback(() => {
    startTransition(() => {
      void (async () => {
        const [w, p] = await Promise.all([listWalletsAction(), listPendingTransactionsAction()]);
        if (w.ok) setWallets(w.wallets);
        if (p.ok) setPending(p.rows);
        onBooksChanged?.();
      })();
    });
  }, [onBooksChanged]);

  const loadDashboard = useCallback((range: DashboardRange) => {
    setDashboardLoading(true);
    void (async () => {
      const r = await getLedgerDashboardAction(range);
      if (r.ok) setDashboardData(r);
      else setDashboardData(null);
      setDashboardLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setImportMsg(null);
    }
  }, [open, refresh]);

  useEffect(() => {
    if (open && tab === "dashboard") {
      loadDashboard(dashboardRange);
    }
  }, [open, tab, dashboardRange, loadDashboard]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 p-0 sm:p-3" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-transparent"
        aria-label="Close tools"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl sm:h-[min(100dvh-1.5rem,calc(100dvh-1.5rem))] sm:rounded-l-xl sm:rounded-r-lg",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-tools-title"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 id="advanced-tools-title" className="text-sm font-semibold">
              Advanced tools
            </h2>
            <p className="text-xs text-muted-foreground">
              Dashboard · import · confirm · wallets · plans · profile · backup
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <PanelRightClose className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b px-2 py-2 scrollbar-thin">
          {(
            [
              ["dashboard", "Dashboard"],
              ["import", "Import"],
              ["confirm", "Confirm"],
              ["wallets", "Wallets"],
              ["plans", "Plans"],
              ["profile", "Profile"],
              ["backup", "Backup"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={tab === id ? "secondary" : "ghost"}
              className="min-w-0 shrink-0 flex-1 text-[10px] sm:text-sm"
              onClick={() => setTab(id)}
              title={id === "profile" ? "Account & profile" : undefined}
              aria-label={id === "profile" ? "Profile — account information" : undefined}
            >
              {id === "profile" ? <User aria-hidden /> : null}
              {label}
              {id === "confirm" && pending.length > 0 ? (
                <span className="ml-1 rounded-full bg-destructive/15 px-1.5 text-[10px] font-medium text-destructive">
                  {pending.length}
                </span>
              ) : null}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "dashboard" ? (
            <DashboardInsights
              range={dashboardRange}
              onRangeChange={setDashboardRange}
              data={dashboardData}
              loading={dashboardLoading}
            />
          ) : null}

          {tab === "import" ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Paste an export from another app (up to {MAX_CSV_PREVIEW_ROWS} data rows). The model guesses columns, assigns a wallet
                and category, and flags repeating bills for confirmation.
              </p>
              <Textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'Example:\nDate,Description,Amount\n2025-01-02,Starbucks,-5.40'}
                className="min-h-[140px] font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="max-w-full text-xs"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setCsvText(await f.text());
                    e.target.value = "";
                  }}
                />
              </div>
              {importMsg ? (
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">{importMsg}</p>
              ) : null}
              <Button
                type="button"
                disabled={isPending || !csvText.trim()}
                className="w-full"
                onClick={() => {
                  setImportMsg(null);
                  startTransition(() => {
                    void (async () => {
                      const fd = new FormData();
                      fd.set("csvText", csvText);
                      const r = await importCsvWithLlmAction(fd);
                      if (r.ok) {
                        setImportMsg(`${r.summary}\nImported: ${r.imported}. Pending review: ${r.pending}.`);
                        setCsvText("");
                        refresh();
                        setTab("confirm");
                      } else {
                        setImportMsg(r.error);
                      }
                    })();
                  });
                }}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  "Import with AI"
                )}
              </Button>
            </div>
          ) : null}

          {tab === "confirm" ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                One-time vs recurring: if NekoZeni is unsure (bills, loans, subscriptions), entries wait here until you
                choose.
              </p>
              {pending.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing waiting — you&apos;re all caught up.</p>
              ) : (
                <ul className="space-y-3">
                  {pending.map((t) => (
                    <li key={t.id} className="rounded-xl border bg-card p-3 text-xs shadow-sm">
                      <div className="font-medium text-foreground">
                        {formatMoney(t.amountCents, t.currency)} {t.direction === "out" ? "out" : "in"} ·{" "}
                        {t.walletName}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {(t.merchant || t.memo || "No description") + ` · ${t.categoryName}`}
                      </div>
                      {t.confirmReason ? (
                        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                          {t.confirmReason}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => {
                            startTransition(() => {
                              void (async () => {
                                await confirmTransactionAction(t.id, "one_time");
                                refresh();
                              })();
                            });
                          }}
                        >
                          One-time
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            startTransition(() => {
                              void (async () => {
                                await confirmTransactionAction(t.id, "start_recurring_monthly");
                                refresh();
                              })();
                            });
                          }}
                        >
                          Repeats monthly
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => {
                            startTransition(() => {
                              void (async () => {
                                await rejectPendingTransactionAction(t.id);
                                refresh();
                              })();
                            });
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "wallets" ? (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">
                Split spending across wallets (Main, Savings, Credit card, …). The chat model picks a wallet by name.
              </p>
              <ul className="space-y-2">
                {wallets.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{w.name}</span>
                    <span className="text-muted-foreground">
                      {w.kind}
                      {w.isDefault ? " · default" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = walletName.trim();
                  if (!name) return;
                  startTransition(() => {
                    void (async () => {
                      const fd = new FormData();
                      fd.set("name", name);
                      const r = await createWalletAction(fd);
                      if (r.ok) {
                        setWalletName("");
                        refresh();
                      }
                    })();
                  });
                }}
              >
                <Input
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  placeholder="New wallet name"
                  className="text-sm"
                />
                <Button type="submit" size="sm" disabled={isPending || !walletName.trim()}>
                  Add
                </Button>
              </form>
            </div>
          ) : null}

          {tab === "plans" ? <ToolsPlansTab active={tab === "plans"} onChanged={refresh} /> : null}

          {tab === "profile" ? <ToolsProfileTab active={tab === "profile"} /> : null}

          {tab === "backup" ? (
            <div className="space-y-4 text-sm">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your wallets, categories, transactions, recurring series, import batches, financial plans, and{" "}
                <span className="font-medium text-foreground">saved receipt / image uploads</span> from chat live
                under your account. Download JSON (ledger only) or a full ZIP (ledger + files + a training manifest).
                Restore only from exports you made while signed in with the{" "}
                <span className="font-medium text-foreground">same email</span>.
              </p>

              <div className="rounded-xl border bg-card p-3">
                <div className="text-xs font-medium text-foreground">Download backup</div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  JSON: ledger tables only. ZIP: same JSON plus <code className="text-foreground">media/</code> files
                  and <code className="text-foreground">training_manifest.json</code> for optional future model
                  training (each file has <code className="text-foreground">trainingOptIn</code>, off by default). Neither
                  includes your password. Keep exports private.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3 w-full gap-2"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => {
                      void (async () => {
                        setBackupMsg(null);
                        const res = await fetch("/api/user/backup", { method: "GET", credentials: "same-origin" });
                        if (!res.ok) {
                          const j = (await res.json().catch(() => null)) as { error?: string } | null;
                          setBackupMsg(j?.error ?? `Download failed (${res.status}).`);
                          return;
                        }
                        const blob = await res.blob();
                        const cd = res.headers.get("Content-Disposition");
                        const match = cd?.match(/filename="([^"]+)"/);
                        const name = match?.[1] ?? "neko-zeni-backup.json";
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = name;
                        a.click();
                        URL.revokeObjectURL(url);
                        setBackupMsg("Ledger JSON downloaded.");
                      })();
                    });
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download ledger (JSON)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 w-full gap-2"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => {
                      void (async () => {
                        setBackupMsg(null);
                        const res = await fetch("/api/user/backup?full=1", {
                          method: "GET",
                          credentials: "same-origin",
                        });
                        if (!res.ok) {
                          const j = (await res.json().catch(() => null)) as { error?: string } | null;
                          setBackupMsg(j?.error ?? `Download failed (${res.status}).`);
                          return;
                        }
                        const blob = await res.blob();
                        const cd = res.headers.get("Content-Disposition");
                        const match = cd?.match(/filename="([^"]+)"/);
                        const name = match?.[1] ?? "neko-zeni-full-backup.zip";
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = name;
                        a.click();
                        URL.revokeObjectURL(url);
                        setBackupMsg("Full ZIP backup downloaded.");
                      })();
                    });
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download full backup (ZIP)
                </Button>
              </div>

              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div className="text-xs font-medium text-destructive">Restore from backup</div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Replaces all wallets, categories, transactions, batches, and recurring series. A{" "}
                  <span className="font-medium text-foreground">.zip</span> from “full backup” also replaces saved
                  chat images/PDFs for this account. Cannot be undone.
                </p>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json,application/json,.zip,application/zip"
                  className="mt-2 max-w-full text-xs"
                />
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={restoreConfirm}
                    onChange={(e) => setRestoreConfirm(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand this will permanently replace my current ledger data for this account.</span>
                </label>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-3 w-full gap-2"
                  disabled={isPending || !restoreConfirm}
                  onClick={() => {
                    const input = restoreInputRef.current;
                    const file = input?.files?.[0];
                    if (!file) {
                      setBackupMsg("Choose a backup .json or .zip file first.");
                      return;
                    }
                    setBackupMsg(null);
                    startTransition(() => {
                      void (async () => {
                        const fd = new FormData();
                        fd.set("file", file);
                        fd.set("confirm", "true");
                        const res = await fetch("/api/user/restore", {
                          method: "POST",
                          body: fd,
                          credentials: "same-origin",
                        });
                        const j = (await res.json().catch(() => null)) as { error?: string; ok?: boolean } | null;
                        if (!res.ok) {
                          setBackupMsg(j?.error ?? `Restore failed (${res.status}).`);
                          return;
                        }
                        setRestoreConfirm(false);
                        if (input) input.value = "";
                        setBackupMsg("Restore complete. Your ledger matches the backup file.");
                        refresh();
                        router.refresh();
                      })();
                    });
                  }}
                >
                  <Upload className="h-4 w-4" />
                  Restore from file
                </Button>
              </div>

              {backupMsg ? (
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">{backupMsg}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
