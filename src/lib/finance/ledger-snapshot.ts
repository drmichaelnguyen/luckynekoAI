import type { PrismaClient } from "@prisma/client";

function centsToMajor(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)}`;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Compact readout of saved ledger rows for Ask mode.
 * Dates are UTC calendar days, matching the dashboard month window.
 */
export async function ledgerSnapshotLines(db: PrismaClient, userId: string): Promise<string> {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    const currency = (user?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);

    const savedWhere = {
      userId,
      status: { not: "rejected" as const },
    };

    const monthOutWhere = { ...savedWhere, currency, direction: "out" as const, occurredAt: { gte: monthStart } };
    const monthInWhere = { ...savedWhere, currency, direction: "in" as const, occurredAt: { gte: monthStart } };
    const last30OutWhere = { ...savedWhere, currency, direction: "out" as const, occurredAt: { gte: last30 } };
    const last30InWhere = { ...savedWhere, currency, direction: "in" as const, occurredAt: { gte: last30 } };

    const [
      recent,
      categories,
      monthOutSum,
      monthOutCount,
      monthInSum,
      monthInCount,
      last30OutSum,
      last30OutCount,
      last30InSum,
      last30InCount,
      monthByCategory,
      pendingCount,
      savedCount,
    ] = await Promise.all([
      db.transaction.findMany({
        where: savedWhere,
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 40,
        select: {
          occurredAt: true,
          direction: true,
          amountCents: true,
          currency: true,
          merchant: true,
          memo: true,
          status: true,
          recurrence: true,
          wallet: { select: { name: true } },
          category: { select: { name: true } },
        },
      }),
      db.category.findMany({
        where: { userId },
        select: { id: true, name: true },
      }),
      db.transaction.aggregate({ where: monthOutWhere, _sum: { amountCents: true } }),
      db.transaction.count({ where: monthOutWhere }),
      db.transaction.aggregate({ where: monthInWhere, _sum: { amountCents: true } }),
      db.transaction.count({ where: monthInWhere }),
      db.transaction.aggregate({ where: last30OutWhere, _sum: { amountCents: true } }),
      db.transaction.count({ where: last30OutWhere }),
      db.transaction.aggregate({ where: last30InWhere, _sum: { amountCents: true } }),
      db.transaction.count({ where: last30InWhere }),
      db.transaction.groupBy({
        by: ["categoryId"],
        where: monthOutWhere,
        _sum: { amountCents: true },
      }),
      db.transaction.count({ where: { userId, status: "pending_user" } }),
      db.transaction.count({ where: savedWhere }),
    ]);

    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const categoryLines = monthByCategory
      .map((row) => ({
        name: row.categoryId ? (catName.get(row.categoryId) ?? "Uncategorized") : "Uncategorized",
        cents: row._sum.amountCents ?? 0,
      }))
      .filter((row) => row.cents !== 0)
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 12)
      .map((row) => `${row.name} ${centsToMajor(row.cents)}`);

    const monthOutCents = monthOutSum._sum.amountCents ?? 0;
    const monthInCents = monthInSum._sum.amountCents ?? 0;
    const last30OutCents = last30OutSum._sum.amountCents ?? 0;
    const last30InCents = last30InSum._sum.amountCents ?? 0;

    const lines: string[] = [
      "USER LEDGER SNAPSHOT (saved rows only; dates are UTC calendar days; do not invent rows or totals beyond this):",
      `Preferred currency: ${currency}`,
      `Saved transactions (excluding rejected): ${savedCount}. Pending user confirm: ${pendingCount}.`,
      `This calendar month (UTC, ${currency} only): expenses ${centsToMajor(monthOutCents)} (${monthOutCount} out), income ${centsToMajor(monthInCents)} (${monthInCount} in), net ${centsToMajor(monthInCents - monthOutCents)}.`,
      `Last 30 days (${currency} only): expenses ${centsToMajor(last30OutCents)} (${last30OutCount} out), income ${centsToMajor(last30InCents)} (${last30InCount} in), net ${centsToMajor(last30InCents - last30OutCents)}.`,
      categoryLines.length > 0
        ? `Expenses by category this month (${currency}): ${categoryLines.join("; ")}.`
        : `Expenses by category this month (${currency}): none.`,
    ];

    if (recent.length === 0) {
      lines.push("Recent transactions: none saved yet.");
    } else {
      lines.push(
        `Recent transactions (newest first, up to 40, all currencies; ${savedCount > recent.length ? "older rows are omitted" : "this is the full saved list"}):`,
      );
      for (const tx of recent) {
        const merchant = clip(tx.merchant, 80);
        const memo = clip(tx.memo, 80);
        const bits = [
          utcDay(tx.occurredAt),
          tx.direction,
          centsToMajor(tx.amountCents),
          tx.currency,
          tx.category?.name ?? "Uncategorized",
          merchant ? `merchant:${merchant}` : "merchant:(none)",
          `wallet:${tx.wallet.name}`,
          tx.status,
          tx.recurrence,
        ];
        if (memo) bits.push(`memo:${memo}`);
        lines.push(`- ${bits.join(" · ")}`);
      }
    }

    return lines.join("\n").slice(0, 12_000);
  } catch (e) {
    console.error("[nekozen] ledgerSnapshotLines failed", e);
    return "USER LEDGER SNAPSHOT: could not be loaded. Say you cannot see saved transactions right now and ask the user to try again. Do not invent figures.";
  }
}
