"use client";

import { BarChart2, Download, FileInput, Loader2, PanelRightClose, RefreshCw, Shield, Upload, User, Wallet, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { importCsvWithLlmAction } from "@/actions/csv-import";
import type { DashboardRange, LedgerDashboardResult } from "@/actions/dashboard";
import { getLedgerDashboardAction } from "@/actions/dashboard";
import {
  confirmTransactionAction,
  createWalletAction,
  deleteRecurrentSeriesAction,
  listPendingTransactionsAction,
  listRecurrentSeriesAction,
  listWalletsAction,
  rejectPendingTransactionAction,
  updateRecurrentSeriesAction,
  type RecurrentSeriesRow,
} from "@/actions/finance";
import { parseCadenceInput, type RecurrentCadence } from "@/lib/finance/cadence";
import { DashboardInsights } from "@/components/chat/dashboard-insights";
import { ToolsPlansTab } from "@/components/chat/tools-plans-tab";
import { ToolsProfileTab } from "@/components/chat/tools-profile-tab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type AdvancedToolsTabId =
  | "dashboard"
  | "import"
  | "confirm"
  | "recurring"
  | "wallets"
  | "plans"
  | "profile"
  | "backup";

type Tab = AdvancedToolsTabId;

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
      className="relative h-9 w-9 shrink-0 gap-1.5 px-0 sm:h-auto sm:w-auto sm:px-3"
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
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  onBooksChanged?: () => void;
  /** When the panel opens (or this value changes while open), selects this tab. */
  initialTab?: AdvancedToolsTabId;
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

  useEffect(() => {
    if (!open) return;
    setTab(initialTab ?? "dashboard");
  }, [open, initialTab]);

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
              Dashboard · import · confirm · recurring · wallets · plans · profile · backup
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <PanelRightClose className="h-5 w-5" />
          </Button>
        </div>

        {/* Tab navigation — icon grid on mobile, compact row on sm+ */}
        <div className="grid grid-cols-4 gap-px border-b bg-border sm:flex sm:gap-0 sm:bg-transparent sm:border-b">
          {(
            [
              ["dashboard", "Analytics", BarChart2],
              ["import",    "Import",    FileInput],
              ["confirm",   "Confirm",   RefreshCw],
              ["recurring", "Recurring", RefreshCw],
              ["wallets",   "Wallets",   Wallet],
              ["plans",     "Plans",     Shield],
              ["profile",   "Profile",   User],
              ["backup",    "Backup",    Download],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
              aria-pressed={tab === id}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 bg-background py-2.5 px-1 text-[10px] font-medium transition-colors sm:flex-row sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs",
                tab === id
                  ? "text-primary bg-primary/8"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={tab === id ? 2.5 : 1.8} />
              <span className="leading-none">{label}</span>
              {id === "confirm" && pending.length > 0 ? (
                <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground sm:static sm:ml-0.5 sm:h-4 sm:min-w-4 sm:text-[10px]">
                  {pending.length > 9 ? "9+" : pending.length}
                </span>
              ) : null}
            </button>
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
                Paste an export from another app. Large files are processed in chunks; the model guesses columns, assigns a wallet and
                category, and flags repeating bills for confirmation.
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
                        setImportMsg(
                          `${r.summary}\nImported: ${r.imported}. Pending review: ${r.pending}.${
                            r.pending > 0 ? "\nOpen Confirm to review repeating bills." : ""
                          }`,
                        );
                        setCsvText("");
                        refresh();
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
                    <PendingConfirmRow
                      key={t.id}
                      item={t}
                      isPending={isPending}
                      onRefresh={refresh}
                      startTransition={startTransition}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "recurring" ? (
            <RecurringTab active={tab === "recurring"} onChanged={refresh} />
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

type PendingRow = {
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
};

const CADENCE_CHOICES: { value: RecurrentCadence | "custom"; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom…" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + days * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

function defaultNextDateFor(anchorIso: string, cadence: RecurrentCadence): string {
  const days = cadence === "weekly" ? 7 : cadence === "yearly" ? 365 : 30;
  return addDays(anchorIso, days);
}

function PendingConfirmRow({
  item,
  isPending,
  onRefresh,
  startTransition,
}: {
  item: PendingRow;
  isPending: boolean;
  onRefresh: () => void;
  startTransition: (fn: () => void) => void;
}) {
  const [repeats, setRepeats] = useState<"one_time" | RecurrentCadence | "custom">("one_time");
  const [customText, setCustomText] = useState("");
  const [nextDate, setNextDate] = useState<string>(() =>
    defaultNextDateFor(item.occurredAt, "monthly"),
  );

  function selectRepeats(next: "one_time" | RecurrentCadence | "custom") {
    setRepeats(next);
    if (next === "one_time" || next === "custom") return;
    setNextDate(defaultNextDateFor(item.occurredAt, next));
  }

  function confirm() {
    startTransition(() => {
      void (async () => {
        if (repeats === "one_time") {
          await confirmTransactionAction(item.id, { kind: "one_time" });
        } else if (repeats === "custom") {
          const parsed = parseCadenceInput(customText);
          await confirmTransactionAction(item.id, {
            kind: "recurring",
            cadence: parsed.cadence,
            customCadence: parsed.customCadence,
            nextReminderAt: nextDate || null,
          });
        } else {
          await confirmTransactionAction(item.id, {
            kind: "recurring",
            cadence: repeats,
            customCadence: null,
            nextReminderAt: nextDate || null,
          });
        }
        onRefresh();
      })();
    });
  }

  return (
    <li className="rounded-xl border bg-card p-3 text-xs shadow-sm">
      <div className="font-medium text-foreground">
        {formatMoney(item.amountCents, item.currency)}{" "}
        {item.direction === "out" ? "out" : "in"} · {item.walletName}
      </div>
      <div className="mt-1 text-muted-foreground">
        {(item.merchant || item.memo || "No description") + ` · ${item.categoryName}`}
      </div>
      {item.confirmReason ? (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          {item.confirmReason}
        </div>
      ) : null}

      <fieldset className="mt-3 space-y-2">
        <legend className="text-[11px] font-medium text-foreground">How often does this repeat?</legend>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={repeats === "one_time" ? "secondary" : "outline"}
            onClick={() => selectRepeats("one_time")}
            className="h-7 px-2 text-[11px]"
          >
            One-time
          </Button>
          {CADENCE_CHOICES.map((c) => (
            <Button
              key={c.value}
              type="button"
              size="sm"
              variant={repeats === c.value ? "secondary" : "outline"}
              onClick={() => selectRepeats(c.value)}
              className="h-7 px-2 text-[11px]"
            >
              {c.label}
            </Button>
          ))}
        </div>
        {repeats === "custom" ? (
          <Input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder='e.g. "every 2 weeks", "quarterly", "every 15th"'
            className="h-8 text-xs"
          />
        ) : null}
        {repeats !== "one_time" ? (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Next reminder
            <Input
              type="date"
              value={toDateInput(nextDate)}
              onChange={(e) => setNextDate(e.target.value)}
              className="h-8 w-auto text-xs"
            />
          </label>
        ) : null}
      </fieldset>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending || (repeats === "custom" && !customText.trim())}
          onClick={confirm}
        >
          {repeats === "one_time" ? "Confirm one-time" : "Confirm recurring"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              void (async () => {
                await rejectPendingTransactionAction(item.id);
                onRefresh();
              })();
            });
          }}
        >
          Dismiss
        </Button>
      </div>
    </li>
  );
}

function RecurringTab({ active, onChanged }: { active: boolean; onChanged?: () => void }) {
  const [rows, setRows] = useState<RecurrentSeriesRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    void listRecurrentSeriesAction().then((r) => {
      if (r.ok) setRows(r.rows);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  if (!active) return null;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Edit cadence, custom description, next reminder, or pause a series. The chat model and reminders respect
        these settings.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recurring series yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <RecurringSeriesEditor
              key={r.id}
              row={r}
              isPending={isPending}
              onChanged={() => {
                load();
                onChanged?.();
              }}
              startTransition={startTransition}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecurringSeriesEditor({
  row,
  isPending,
  onChanged,
  startTransition,
}: {
  row: RecurrentSeriesRow;
  isPending: boolean;
  onChanged: () => void;
  startTransition: (fn: () => void) => void;
}) {
  const [cadence, setCadence] = useState<RecurrentCadence>(row.cadence);
  const [customCadence, setCustomCadence] = useState<string>(row.customCadence ?? "");
  const [nextDate, setNextDate] = useState<string>(
    row.nextReminderAt ? row.nextReminderAt.slice(0, 10) : "",
  );
  const [label, setLabel] = useState<string>(row.label);

  const dirty =
    cadence !== row.cadence ||
    (customCadence || "") !== (row.customCadence ?? "") ||
    nextDate !== (row.nextReminderAt?.slice(0, 10) ?? "") ||
    label !== row.label;

  function save() {
    startTransition(() => {
      void (async () => {
        await updateRecurrentSeriesAction(row.id, {
          label,
          cadence,
          customCadence: cadence === "irregular" ? customCadence : customCadence || null,
          nextReminderAt: nextDate ? nextDate : null,
        });
        onChanged();
      })();
    });
  }

  return (
    <li className="rounded-xl border bg-card p-3 text-xs shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-7 text-xs font-medium"
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatMoney(row.amountCents, row.currency)} {row.direction === "out" ? "out" : "in"} ·{" "}
            {row.walletName} · {row.categoryName}
            {row.isPaused ? " · paused" : ""}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-medium">
          Cadence
          <select
            className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as RecurrentCadence)}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="irregular">Irregular / custom</option>
          </select>
        </label>
        <label className="text-[11px] font-medium">
          Next reminder
          <Input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="mt-1 h-8 text-xs"
          />
        </label>
      </div>

      <label className="mt-2 block text-[11px] font-medium">
        Custom description {cadence !== "irregular" ? "(optional)" : "(required for irregular)"}
        <Input
          value={customCadence}
          onChange={(e) => setCustomCadence(e.target.value)}
          placeholder='e.g. "every 2 weeks", "15th of each month"'
          className="mt-1 h-8 text-xs"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending || !dirty || (cadence === "irregular" && !customCadence.trim())}
          onClick={save}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              void (async () => {
                await updateRecurrentSeriesAction(row.id, { isPaused: !row.isPaused });
                onChanged();
              })();
            });
          }}
        >
          {row.isPaused ? "Resume" : "Pause"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              void (async () => {
                await deleteRecurrentSeriesAction(row.id);
                onChanged();
              })();
            });
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
