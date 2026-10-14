"use client";

import { useState } from "react";

import {
  confirmTransactionAction,
  rejectPendingTransactionAction,
} from "@/actions/finance";
import { parseCadenceInput, type RecurrentCadence } from "@/lib/finance/cadence";
import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PendingConfirmItem = {
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
  categoryIcon: string | null;
};

const CADENCE_CHOICES: { value: RecurrentCadence | "custom"; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom…" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatMoney(cents: number, currency: string) {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

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

export function PendingConfirmRow({
  item,
  isPending,
  onRefresh,
  startTransition,
}: {
  item: PendingConfirmItem;
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
      <div className="flex items-start gap-3">
        {item.categoryIcon ? (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.categoryIcon} alt={item.categoryName} className="h-full w-full object-cover" />
          </div>
        ) : null}
        <div className="flex-1">
          <div className="font-medium text-foreground">
            {formatMoney(item.amountCents, item.currency)}{" "}
            {item.direction === "out" ? "out" : "in"} · {item.walletName}
          </div>
          <div className="mt-1 text-muted-foreground">
            {(item.merchant || item.memo || "No description") + ` · ${item.categoryName}`}
          </div>
        </div>
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
