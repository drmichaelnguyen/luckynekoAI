"use server";

import { auth } from "@/auth";
import { searchLedgerText, type LedgerPlanHit, type LedgerTransactionHit } from "@/lib/finance/ledger-query";
import { prisma } from "@/lib/prisma";

export async function searchTransactionsAction(query: string): Promise<
  | { ok: true; terms: string[]; transactions: LedgerTransactionHit[]; plans: LedgerPlanHit[] }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, terms: [], transactions: [], plans: [] };
  const found = await searchLedgerText(prisma, session.user.id, trimmed);
  return { ok: true, ...found };
}
