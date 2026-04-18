"use server";

import { auth } from "@/auth";
import { ensureFinanceSeed } from "@/lib/finance/seed";
import { prisma } from "@/lib/prisma";

export async function listWalletsAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  await ensureFinanceSeed(prisma, session.user.id);
  const wallets = await prisma.wallet.findMany({
    where: { userId: session.user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return { ok: true as const, wallets };
}

export async function createWalletAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 64) {
    return { ok: false as const, error: "Wallet name should be 1–64 characters." };
  }
  await ensureFinanceSeed(prisma, session.user.id);
  const maxSort = await prisma.wallet.aggregate({
    where: { userId: session.user.id },
    _max: { sortOrder: true },
  });
  await prisma.wallet.create({
    data: {
      userId: session.user.id,
      name,
      kind: "spending",
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
  return { ok: true as const };
}

export async function getPendingConfirmCountAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized", count: 0 };
  const count = await prisma.transaction.count({
    where: { userId: session.user.id, status: "pending_user" },
  });
  return { ok: true as const, count };
}

export async function listPendingTransactionsAction() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const rows = await prisma.transaction.findMany({
    where: { userId: session.user.id, status: "pending_user" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { wallet: true, category: true },
  });
  return {
    ok: true as const,
    rows: rows.map((t) => ({
      id: t.id,
      amountCents: t.amountCents,
      direction: t.direction,
      currency: t.currency,
      merchant: t.merchant,
      memo: t.memo,
      occurredAt: t.occurredAt.toISOString(),
      recurrence: t.recurrence,
      confirmReason: t.confirmReason,
      walletName: t.wallet.name,
      categoryName: t.category?.name ?? "Other",
    })),
  };
}

export async function confirmTransactionAction(
  id: string,
  mode: "one_time" | "start_recurring_monthly",
) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };

  const tx = await prisma.transaction.findFirst({
    where: { id, userId: session.user.id, status: "pending_user" },
    include: { wallet: true, category: true },
  });
  if (!tx) return { ok: false as const, error: "Nothing to confirm." };

  if (mode === "one_time") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { recurrence: "one_time", status: "posted", confirmReason: null },
    });
    return { ok: true as const };
  }

  const series = await prisma.recurrentSeries.create({
    data: {
      userId: session.user.id,
      walletId: tx.walletId,
      categoryId: tx.categoryId,
      label: tx.merchant ?? tx.memo ?? "Recurring",
      cadence: "monthly",
      amountCents: tx.amountCents,
      direction: tx.direction,
      nextReminderAt: new Date(tx.occurredAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      notes: "Created from a confirmed chat or CSV import.",
    },
  });

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      recurrence: "recurrent",
      status: "posted",
      recurrentSeriesId: series.id,
      confirmReason: null,
    },
  });

  return { ok: true as const };
}

export async function rejectPendingTransactionAction(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Unauthorized" };
  const r = await prisma.transaction.updateMany({
    where: { id, userId: session.user.id, status: "pending_user" },
    data: { status: "rejected" },
  });
  if (r.count === 0) return { ok: false as const, error: "Not found." };
  return { ok: true as const };
}
