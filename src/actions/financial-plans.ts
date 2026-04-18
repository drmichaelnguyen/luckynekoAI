"use server";

import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const PlanKindSchema = z.enum(["spending_budget", "savings_goal"]);
const PlanPeriodSchema = z.enum(["none", "weekly", "monthly", "yearly"]);

export type FinancialPlanRow = {
  id: string;
  kind: "spending_budget" | "savings_goal";
  title: string;
  description: string | null;
  amountCents: number | null;
  currency: string;
  period: "none" | "weekly" | "monthly" | "yearly";
  targetDate: string | null;
  sortOrder: number;
};

export async function listFinancialPlansAction(): Promise<
  { ok: true; plans: FinancialPlanRow[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };

  const rows = await prisma.financialPlan.findMany({
    where: { userId: session.user.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return {
    ok: true,
    plans: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      amountCents: r.amountCents,
      currency: r.currency,
      period: r.period,
      targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
      sortOrder: r.sortOrder,
    })),
  };
}

const UpsertPlanSchema = z.object({
  id: z
    .string()
    .max(40)
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  kind: PlanKindSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  amountMajor: z.string().max(32).optional().nullable(),
  currency: z.string().length(3).optional(),
  period: PlanPeriodSchema.optional(),
  targetDate: z.string().max(32).optional().nullable(),
});

function parseAmountCents(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseFloat(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  return cents > 0 ? cents : null;
}

export async function upsertFinancialPlanAction(formData: FormData): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };

  const parsed = UpsertPlanSchema.safeParse({
    id: (formData.get("id") as string) || "",
    kind: formData.get("kind"),
    title: formData.get("title"),
    description: formData.get("description") || null,
    amountMajor: (formData.get("amountMajor") as string) || null,
    currency: (formData.get("currency") as string) || "CAD",
    period: (formData.get("period") as string) || "none",
    targetDate: (formData.get("targetDate") as string) || null,
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid plan fields." };
  }

  const d = parsed.data;
  const amountCents = parseAmountCents(d.amountMajor ?? undefined);
  const currency = (d.currency ?? "CAD").toUpperCase().slice(0, 3);
  const targetDate =
    d.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(d.targetDate) ? new Date(`${d.targetDate}T12:00:00.000Z`) : null;

  if (d.id) {
    const existing = await prisma.financialPlan.findFirst({
      where: { id: d.id, userId: session.user.id },
    });
    if (!existing) return { ok: false, error: "Plan not found." };
    await prisma.financialPlan.update({
      where: { id: d.id },
      data: {
        kind: d.kind,
        title: d.title,
        description: d.description ?? null,
        amountCents,
        currency,
        period: d.period ?? "none",
        targetDate,
      },
    });
    return { ok: true };
  }

  const maxSort = await prisma.financialPlan.aggregate({
    where: { userId: session.user.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  await prisma.financialPlan.create({
    data: {
      userId: session.user.id,
      kind: d.kind,
      title: d.title,
      description: d.description ?? null,
      amountCents,
      currency,
      period: d.period ?? "none",
      targetDate,
      sortOrder,
    },
  });
  return { ok: true };
}

export async function deleteFinancialPlanAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };
  const trimmed = id.trim();
  if (!trimmed) return { ok: false, error: "Missing id." };

  const res = await prisma.financialPlan.deleteMany({
    where: { id: trimmed, userId: session.user.id },
  });
  if (res.count === 0) return { ok: false, error: "Plan not found." };
  return { ok: true };
}
