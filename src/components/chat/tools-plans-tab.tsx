"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import {
  deleteFinancialPlanAction,
  listFinancialPlansAction,
  upsertFinancialPlanAction,
  type FinancialPlanRow,
} from "@/actions/financial-plans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, Trash2 } from "lucide-react";

function majorFromCents(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function ToolsPlansTab({ active, onChanged }: { active: boolean; onChanged?: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [plans, setPlans] = useState<FinancialPlanRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<"spending_budget" | "savings_goal">("spending_budget");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [period, setPeriod] = useState<"none" | "weekly" | "monthly" | "yearly">("monthly");
  const [targetDate, setTargetDate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void listFinancialPlansAction().then((r) => {
      if (r.ok) setPlans(r.plans);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  function resetForm() {
    setEditingId(null);
    setKind("spending_budget");
    setTitle("");
    setDescription("");
    setAmountMajor("");
    setCurrency("CAD");
    setPeriod("monthly");
    setTargetDate("");
    setMsg(null);
  }

  function startEdit(p: FinancialPlanRow) {
    setEditingId(p.id);
    setKind(p.kind);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setAmountMajor(majorFromCents(p.amountCents));
    setCurrency(p.currency);
    setPeriod(p.period);
    setTargetDate(p.targetDate ?? "");
    setMsg(null);
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Add a <span className="font-medium text-foreground">spending budget</span> (how much you aim to spend per
        week/month) or a <span className="font-medium text-foreground">savings goal</span> (target amount and optional
        deadline). NekoZeni sees these in chat context when helping you.
      </p>

      {plans.length === 0 ? (
        <p className="text-xs text-muted-foreground">No plans yet — add one below.</p>
      ) : (
        <ul className="space-y-2">
          {plans.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {p.title}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({p.kind === "spending_budget" ? "budget" : "savings"})
                  </span>
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {p.amountCents != null ? `${majorFromCents(p.amountCents)} ${p.currency}` : "No amount set"}
                  {p.period !== "none" ? ` · ${p.period}` : ""}
                  {p.targetDate ? ` · by ${p.targetDate}` : ""}
                </div>
                {p.description ? <div className="mt-1 line-clamp-2">{p.description}</div> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(p)} aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  disabled={isPending}
                  aria-label="Delete"
                  onClick={() => {
                    startTransition(() => {
                      void (async () => {
                        const r = await deleteFinancialPlanAction(p.id);
                        if (r.ok) {
                          load();
                          onChanged?.();
                          if (editingId === p.id) resetForm();
                        }
                      })();
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border bg-muted/20 p-3">
        <h3 className="text-xs font-medium text-foreground">{editingId ? "Edit plan" : "New plan"}</h3>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            startTransition(() => {
              void (async () => {
                const fd = new FormData();
                if (editingId) fd.set("id", editingId);
                fd.set("kind", kind);
                fd.set("title", title.trim());
                fd.set("description", description.trim());
                fd.set("amountMajor", amountMajor.trim());
                fd.set("currency", currency.trim().toUpperCase().slice(0, 3));
                fd.set("period", kind === "spending_budget" ? period : "none");
                fd.set("targetDate", kind === "savings_goal" ? targetDate.trim() : "");
                const r = await upsertFinancialPlanAction(fd);
                if (r.ok) {
                  resetForm();
                  load();
                  onChanged?.();
                  setMsg("Saved.");
                } else setMsg(r.error);
              })();
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Type</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={kind}
                onChange={(e) => setKind(e.target.value as "spending_budget" | "savings_goal")}
              >
                <option value="spending_budget">Spending budget</option>
                <option value="savings_goal">Savings goal</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Currency</label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className="h-9 text-xs" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Groceries cap" required className="text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Notes</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px] text-xs" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Amount (major units)</label>
              <Input
                value={amountMajor}
                onChange={(e) => setAmountMajor(e.target.value)}
                placeholder={kind === "spending_budget" ? "e.g. 600" : "e.g. 5000"}
                inputMode="decimal"
                className="text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {kind === "spending_budget" ? "Cap per period below." : "Target to save (optional)."}
              </p>
            </div>
            {kind === "spending_budget" ? (
              <div className="space-y-1">
                <label className="text-[11px] font-medium">Period</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as typeof period)}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="none">One-time / other</option>
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[11px] font-medium">Target date (optional)</label>
                <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="text-xs" />
              </div>
            )}
          </div>
          {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save changes" : "Add plan"}
            </Button>
            {editingId ? (
              <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
