import type { PrismaClient } from "@prisma/client";

import { merchantFromPlanTitle } from "@/lib/finance/plan-suggestion";

export async function convertPlanToTransaction(
  db: PrismaClient,
  userId: string,
  planId: string,
  options?: { occurredAt?: Date; walletId?: string; categoryId?: string | null },
): Promise<{ ok: true; transactionId: string } | { ok: false; error: string }> {
  const id = planId.trim();
  if (!id) return { ok: false, error: "Missing plan." };

  const plan = await db.financialPlan.findFirst({ where: { id, userId } });
  if (!plan) return { ok: false, error: "Plan not found." };
  if (plan.amountCents == null || plan.amountCents <= 0) {
    return { ok: false, error: "This plan has no amount, so it cannot be marked as bought." };
  }

  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  let wallet = wallets.find((row) => row.isDefault) ?? wallets[0];
  if (options?.walletId) {
    const chosen = wallets.find((row) => row.id === options.walletId);
    if (!chosen) return { ok: false, error: "Wallet not found." };
    wallet = chosen;
  }
  if (!wallet) return { ok: false, error: "No wallet configured." };

  let categoryId: string | null = null;
  if (options?.categoryId) {
    const category = await db.category.findFirst({
      where: { id: options.categoryId, userId },
      select: { id: true },
    });
    if (!category) return { ok: false, error: "Category not found." };
    categoryId = category.id;
  }

  const occurredAt = options?.occurredAt && !Number.isNaN(options.occurredAt.getTime()) ? options.occurredAt : new Date();
  const merchant = merchantFromPlanTitle(plan.title).slice(0, 200);

  try {
    const transactionId = await db.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          categoryId,
          amountCents: plan.amountCents!,
          direction: "out",
          currency: plan.currency,
          merchant,
          memo: plan.description,
          occurredAt,
          recurrence: "one_time",
          status: "posted",
          source: "chat",
        },
      });
      await tx.financialPlan.delete({ where: { id: plan.id } });
      return created.id;
    });
    return { ok: true, transactionId };
  } catch {
    return { ok: false, error: "Could not mark this plan as bought." };
  }
}
