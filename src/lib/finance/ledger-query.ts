import type { PrismaClient } from "@prisma/client";

/** Lowercase, strip diacritics, and collapse punctuation so Vietnamese and English match the same way. */
export function normalizeQueryText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const IGNORED_SEARCH_WORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "of",
  "for",
  "to",
  "and",
  "or",
  "in",
  "on",
  "at",
  "from",
  "with",
  "this",
  "that",
  "what",
  "where",
  "when",
  "how",
  "do",
  "did",
  "have",
  "has",
  "had",
  "we",
  "you",
  "your",
  "about",
  "there",
  "is",
  "it",
  "any",
  "data",
  "record",
  "records",
  "buy",
  "bought",
  "buying",
  "purchased",
  "ordered",
  "got",
  "mua",
]);

const COMPLETED_PURCHASE_PHRASES = [
  "bought",
  "i paid",
  "paid for",
  "purchased",
  "got it for",
  "picked up",
  "spent",
  "da mua",
  "vua mua",
  "mua roi",
  "da tra",
];

const PLAN_INTENT_PHRASES = [
  "want to",
  "planning",
  "thinking of",
  "should i",
  "can i afford",
  "going to",
  "will buy",
  "muon mua",
  "dinh mua",
  "sap mua",
];

const LOOKUP_PHRASES = ["do we have", "do i have", "did i", "have i", "is there", "any data", "any record"];

function hasPhrase(text: string, phrase: string): boolean {
  const pattern = phrase
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`).test(text);
}

function matchesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

/** Questions and ledger lookups, including ones with no question mark. */
export function looksLikeLedgerLookup(message: string): boolean {
  if (message.includes("?")) return true;
  const text = normalizeQueryText(message);
  if (!text) return false;
  return matchesAny(text, LOOKUP_PHRASES);
}

/**
 * True when the user is reporting a purchase that already happened.
 * Intent wording ("I want to buy") returns false. Neither wording returns false.
 */
export function looksLikeCompletedPurchase(message: string): boolean {
  const text = normalizeQueryText(message);
  if (!text) return false;
  if (matchesAny(text, COMPLETED_PURCHASE_PHRASES)) return true;
  if (matchesAny(text, PLAN_INTENT_PHRASES)) return false;
  return false;
}

/** True when the user is stating a purchase to record, not asking whether it exists. */
export function looksLikeDeclarativePurchase(message: string): boolean {
  if (looksLikeLedgerLookup(message)) return false;
  return looksLikeCompletedPurchase(message);
}

/** True only when the user explicitly describes future intent, not a completed buy. */
export function hasExplicitPlanIntent(message: string): boolean {
  const text = normalizeQueryText(message);
  if (!text || looksLikeCompletedPurchase(message)) return false;
  return matchesAny(text, PLAN_INTENT_PHRASES);
}

export function extractSearchTerms(input: string): string[] {
  const words = normalizeQueryText(input).split(" ").filter(Boolean);
  const terms: string[] = [];
  for (const word of words) {
    if (word.length < 2) continue;
    if (IGNORED_SEARCH_WORDS.has(word)) continue;
    if (!terms.includes(word)) terms.push(word);
  }
  return terms;
}

export type LedgerQuery = {
  terms: string[];
  raw: string;
};

/**
 * Parse a chat message as a ledger lookup.
 * Returns null for declarative purchases ("I bought…") so those are saved, not searched.
 * Lookup phrasing still searches, even when the sentence also contains "i bought".
 */
export function parseLedgerQuery(message: string): LedgerQuery | null {
  const raw = normalizeQueryText(message);
  if (!raw) return null;
  if (looksLikeDeclarativePurchase(message)) return null;
  const terms = extractSearchTerms(raw);
  if (terms.length === 0) return null;
  if (!looksLikeLedgerLookup(message)) {
    // A bare item mention is not a search. Chat search runs for lookups and questions.
    return null;
  }
  return { terms, raw };
}

export function textMatchesTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const text = normalizeQueryText(haystack);
  return terms.every((term) => text.includes(term));
}

export type LedgerTransactionHit = {
  id: string;
  merchant: string | null;
  memo: string | null;
  amountCents: number;
  currency: string;
  occurredAt: string;
  categoryName: string;
  walletName: string;
  status: string;
};

export type LedgerPlanHit = {
  id: string;
  title: string;
  description: string | null;
  amountCents: number | null;
  currency: string;
};

export async function searchLedgerText(
  db: PrismaClient,
  userId: string,
  query: string,
): Promise<{ terms: string[]; transactions: LedgerTransactionHit[]; plans: LedgerPlanHit[] }> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) {
    return { terms, transactions: [], plans: [] };
  }

  const [transactions, plans] = await Promise.all([
    db.transaction.findMany({
      where: { userId, status: { not: "rejected" } },
      orderBy: { occurredAt: "desc" },
      take: 5000,
      include: { category: true, wallet: true },
    }),
    db.financialPlan.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
  ]);

  const transactionHits = transactions
    .filter((row) =>
      textMatchesTerms(
        [row.merchant, row.memo, row.category?.name, row.wallet.name].filter(Boolean).join(" "),
        terms,
      ),
    )
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      merchant: row.merchant,
      memo: row.memo,
      amountCents: row.amountCents,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      categoryName: row.category?.name ?? "Uncategorized",
      walletName: row.wallet.name,
      status: row.status,
    }));

  const planHits = plans
    .filter((row) => textMatchesTerms([row.title, row.description].filter(Boolean).join(" "), terms))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      amountCents: row.amountCents,
      currency: row.currency,
    }));

  return { terms, transactions: transactionHits, plans: planHits };
}

export function formatPlannedPurchaseFallback(plans: LedgerPlanHit[]): string | null {
  if (plans.length === 0) return null;
  const bits = plans.map((plan) => {
    if (plan.amountCents == null) return plan.title;
    const major = (plan.amountCents / 100).toFixed(2);
    return `${plan.title} (${major} ${plan.currency})`;
  });
  return `Not found in transactions, but you have a planned purchase: ${bits.join("; ")}.`;
}

export function formatLookupContext(input: {
  transactions: LedgerTransactionHit[];
  plans: LedgerPlanHit[];
}): string {
  const txLines =
    input.transactions.length === 0
      ? ["TRANSACTIONS: (none)"]
      : [
          "TRANSACTIONS:",
          ...input.transactions.slice(0, 12).map((row) => {
            const label = row.merchant || row.memo || "Transaction";
            return `- ${label}: ${row.amountCents} ${row.currency} cents on ${row.occurredAt.slice(0, 10)} (${row.categoryName}, ${row.walletName})`;
          }),
        ];
  const planLines =
    input.plans.length === 0
      ? ["PLANNED, NOT PURCHASED: (none)"]
      : [
          "PLANNED, NOT PURCHASED:",
          ...input.plans.slice(0, 12).map((plan) => {
            const amt = plan.amountCents != null ? `${plan.amountCents} ${plan.currency} cents` : "no amount";
            const desc = plan.description ? ` — ${plan.description.slice(0, 180)}` : "";
            return `- ${plan.title}: ${amt}${desc}`;
          }),
        ];
  return ["LEDGER LOOKUP (plans are PLANNED, NOT PURCHASED — they are not transactions):", ...txLines, ...planLines].join(
    "\n",
  );
}
