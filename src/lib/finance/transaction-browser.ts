import type { FlowDirection, Prisma, PrismaClient, TxStatus } from "@prisma/client";

import { extractSearchTerms, transactionSearchHaystack } from "@/lib/finance/ledger-query";

export type TransactionBrowseRow = {
  id: string;
  occurredAt: string;
  direction: FlowDirection;
  amountCents: number;
  currency: string;
  merchant: string | null;
  memo: string | null;
  walletId: string;
  walletName: string;
  categoryId: string | null;
  categoryName: string;
  status: TxStatus;
  recurrence: string;
  source: string;
};

export type TransactionBrowseFilters = {
  searchText?: string;
  walletId?: string;
  categoryId?: string;
  direction?: "in" | "out" | "all";
  status?: "posted" | "pending_user" | "all";
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
};

function categoryLabel(category: { name: string; parent: { name: string } | null } | null): string {
  if (!category) return "Uncategorized";
  return category.parent ? `${category.parent.name} > ${category.name}` : category.name;
}

export async function browseTransactions(
  db: PrismaClient,
  input: {
    userId: string;
    displayCurrency: string;
    filters?: TransactionBrowseFilters;
  },
): Promise<{
  rows: TransactionBrowseRow[];
  totalCount: number;
  displayCurrency: string;
  truncated: boolean;
}> {
  const filters = input.filters ?? {};
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const offset = Math.max(filters.offset ?? 0, 0);

  const where: Prisma.TransactionWhereInput = {
    userId: input.userId,
    currency: input.displayCurrency,
  };

  if (filters.status === "posted" || filters.status === "pending_user") {
    where.status = filters.status;
  } else {
    where.status = { not: "rejected" };
  }

  if (filters.walletId) where.walletId = filters.walletId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.direction === "in" || filters.direction === "out") {
    where.direction = filters.direction;
  }

  if (filters.fromDate || filters.toDate) {
    const occurredAt: Prisma.DateTimeFilter = {};
    if (filters.fromDate) {
      const from = new Date(`${filters.fromDate.trim()}T00:00:00`);
      if (!Number.isNaN(from.getTime())) occurredAt.gte = from;
    }
    if (filters.toDate) {
      const to = new Date(`${filters.toDate.trim()}T23:59:59.999`);
      if (!Number.isNaN(to.getTime())) occurredAt.lte = to;
    }
    if (Object.keys(occurredAt).length > 0) where.occurredAt = occurredAt;
  }

  const searchTerms = filters.searchText?.trim() ? extractSearchTerms(filters.searchText) : [];

  const allRows = await db.transaction.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    include: { wallet: true, category: { include: { parent: true } } },
  });

  const filtered = allRows.filter((tx) => {
    if (searchTerms.length === 0) return true;
    const categoryName = categoryLabel(tx.category);
    const haystack = transactionSearchHaystack(tx.merchant, tx.memo, categoryName, tx.wallet.name);
    return searchTerms.every((term) => haystack.includes(term));
  });

  const page = filtered.slice(offset, offset + limit).map((tx) => ({
    id: tx.id,
    occurredAt: tx.occurredAt.toISOString(),
    direction: tx.direction,
    amountCents: tx.amountCents,
    currency: tx.currency,
    merchant: tx.merchant,
    memo: tx.memo,
    walletId: tx.walletId,
    walletName: tx.wallet.name,
    categoryId: tx.categoryId,
    categoryName: categoryLabel(tx.category),
    status: tx.status,
    recurrence: tx.recurrence,
    source: tx.source,
  }));

  return {
    rows: page,
    totalCount: filtered.length,
    displayCurrency: input.displayCurrency,
    truncated: filtered.length > offset + limit,
  };
}
