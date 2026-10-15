import type { Prisma, PrismaClient } from "@prisma/client";

import { formatMoneyFromCents } from "@/lib/finance/amount-cents";
import { resolveAnalyticsCategoryScope } from "@/lib/finance/analytics-query";

export type LedgerCategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parent?: { id: string; name: string; slug: string } | null;
};

export type LedgerWalletRow = {
  id: string;
  name: string;
};

export type LedgerQuestionKind = "amount" | "temporal" | "browse";

const LOOKUP_PHRASE_PATTERNS = [
  "oil change",
  "oil and filter",
  "ram 1500",
  "transmission fluid",
  "tire change",
  "differential oil",
] as const;

export type ParsedLedgerQuery = {
  timeRange: { from: Date; to: Date; label: string } | null;
  categoryIds: string[];
  categoryLabel: string | null;
  walletIds: string[];
  walletLabel: string | null;
  /** Multi-word phrases from the user message (e.g. "oil change", "ram 1500"). */
  searchPhrases: string[];
  searchTerms: string[];
  direction: "out" | "in";
  questionKind: LedgerQuestionKind;
  /** "all" = every search term must match (spend totals); "any" = at least one term (when/find). */
  textMatchMode: "all" | "any";
};

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startOfUtcYear(year: number): Date {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
}

function endOfUtcYear(year: number): Date {
  return new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
}

function addUtcMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

export function parseTimeRange(message: string): { from: Date; to: Date; label: string } | null {
  const normalized = normalizeQueryText(message);
  if (!normalized) return null;

  const monthMatch = normalized.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/,
  );
  if (monthMatch) {
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = monthNames.findIndex((name) => monthMatch[1].startsWith(name));
    const year = Number(monthMatch[2]);
    if (monthIndex >= 0) {
      const from = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
      return { from, to, label: `${monthMatch[1]} ${year}` };
    }
  }

  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      from: startOfUtcYear(year),
      to: endOfUtcYear(year),
      label: `${year}`,
    };
  }

  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  if (/\bthis year\b/.test(normalized) || /\bytd\b/.test(normalized) || /\byear to date\b/.test(normalized)) {
    return { from: startOfUtcYear(thisYear), to: addUtcMonths(startOfUtcYear(thisYear), 12), label: "this year" };
  }

  if (/\blast year\b/.test(normalized)) {
    return {
      from: startOfUtcYear(thisYear - 1),
      to: startOfUtcYear(thisYear),
      label: `${thisYear - 1}`,
    };
  }

  if (/\bthis month\b|\bcurrent month\b|\bmonth to date\b|\bmtd\b/.test(normalized)) {
    return { from: thisMonthStart, to: addUtcMonths(thisMonthStart, 1), label: "this month" };
  }

  if (/\blast month\b/.test(normalized)) {
    const lastMonthStart = addUtcMonths(thisMonthStart, -1);
    return { from: lastMonthStart, to: thisMonthStart, label: "last month" };
  }

  if (/\blast 30 days\b|\b30d\b|\bpast 30 days\b/.test(normalized)) {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return { from, to: new Date(), label: "last 30 days" };
  }

  if (/\bthis week\b/.test(normalized)) {
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset, 0, 0, 0, 0));
    return { from, to: new Date(), label: "this week" };
  }

  if (/\btoday\b/.test(normalized)) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    return { from, to: new Date(), label: "today" };
  }

  if (/\byesterday\b/.test(normalized)) {
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const from = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    return { from, to: todayStart, label: "yesterday" };
  }

  return null;
}

function extractSearchPhrases(message: string): string[] {
  const normalized = normalizeQueryText(message);
  if (!normalized) return [];
  const found: string[] = [];
  for (const phrase of LOOKUP_PHRASE_PATTERNS) {
    if (normalized.includes(phrase)) found.push(phrase);
  }
  return found;
}

function stripTokensCoveredByPhrases(tokens: string[], phrases: string[]): string[] {
  if (phrases.includes("oil change")) {
    return tokens.filter((token) => token !== "change");
  }
  return tokens;
}

export function extractSearchTerms(message: string): string[] {
  const normalized = normalizeQueryText(message);
  if (!normalized) return [];
  const stopwords = new Set([
    "how",
    "much",
    "many",
    "did",
    "have",
    "was",
    "were",
    "are",
    "any",
    "all",
    "my",
    "me",
    "i",
    "you",
    "show",
    "find",
    "list",
    "search",
    "lookup",
    "view",
    "see",
    "get",
    "pull",
    "display",
    "check",
    "what",
    "which",
    "where",
    "when",
    "do",
    "done",
    "ride",
    "rides",
    "trip",
    "trips",
    "times",
    "time",
    "spend",
    "spent",
    "spending",
    "income",
    "earned",
    "earning",
    "earnings",
    "revenue",
    "deposit",
    "deposits",
    "inflow",
    "inflows",
    "received",
    "salary",
    "paycheck",
    "paychecks",
    "payroll",
    "wage",
    "wages",
    "paid",
    "pay",
    "got",
    "buy",
    "bought",
    "buying",
    "purchased",
    "ordered",
    "mua",
    "we",
    "about",
    "there",
    "is",
    "it",
    "net",
    "gross",
    "bonus",
    "commission",
    "for",
    "on",
    "in",
    "at",
    "the",
    "a",
    "an",
    "to",
    "of",
    "and",
    "or",
    "this",
    "that",
    "last",
    "year",
    "month",
    "week",
    "today",
    "yesterday",
    "transactions",
    "transaction",
    "purchases",
    "purchase",
    "payments",
    "payment",
    "records",
    "record",
    "data",
    "ledger",
    "history",
    "wallet",
    "wallets",
    "account",
    "accounts",
    "bao",
    "nhieu",
    "da",
    "tieu",
    "chi",
    "phi",
    "thu",
    "nhap",
    "trong",
    "vi",
    "cua",
    "cho",
    "nam",
    "thang",
    "tim",
    "hien",
    "danh",
    "sach",
    "giao",
    "dich",
    "xem",
    "du",
    "lieu",
    "hien",
    "tai",
  ]);

  return normalized
    .split(" ")
    .filter((token) => token.length >= 2 && !stopwords.has(token) && !/^20\d{2}$/.test(token))
    .filter((token, index, arr) => arr.indexOf(token) === index);
}

function selectWalletScope(wallets: LedgerWalletRow[], message: string): { walletIds: string[]; walletLabel: string | null } {
  const normalized = normalizeQueryText(message);
  if (!normalized) return { walletIds: [], walletLabel: null };

  let best: LedgerWalletRow | null = null;
  let bestScore = 0;
  for (const wallet of wallets) {
    const walletNorm = normalizeQueryText(wallet.name);
    if (!walletNorm) continue;
    let score = 0;
    if (normalized === walletNorm) score = 100;
    else if (
      normalized.includes(` ${walletNorm} `) ||
      normalized.startsWith(`${walletNorm} `) ||
      normalized.endsWith(` ${walletNorm}`) ||
      normalized.includes(walletNorm)
    ) {
      score = 90 + Math.min(walletNorm.split(" ").length * 2, 10);
    } else {
      const tokens = normalized.split(" ").filter(Boolean);
      const matchedTokens = walletNorm.split(" ").filter((t) => tokens.includes(t)).length;
      if (matchedTokens > 0) score = matchedTokens * 12;
    }
    if (score > bestScore) {
      best = wallet;
      bestScore = score;
    }
  }

  if (!best || bestScore < 12) return { walletIds: [], walletLabel: null };
  return { walletIds: [best.id], walletLabel: best.name };
}

function removeScopeTerms(searchTerms: string[], scopes: Array<string | null>): string[] {
  const scopeTokens = new Set(
    scopes
      .flatMap((scope) => normalizeQueryText(scope ?? "").split(" "))
      .filter((token) => token.length >= 2),
  );
  return searchTerms.filter((term) => !scopeTokens.has(term));
}

function parseDirection(message: string): "out" | "in" {
  const normalized = normalizeQueryText(message);
  if (
    /\b(income|earned|earnings|revenue|deposit|inflow|received|salary|paycheck|payroll|wages|paid me|got paid|get paid|thu nhap|tien vao|doanh thu|nhan duoc|luong)\b/.test(
      normalized,
    )
  ) {
    return "in";
  }
  return "out";
}

function looksLikeAnalyticsOnlyRequest(message: string): boolean {
  const normalized = normalizeQueryText(message);
  return /\b(analytics|analyse|analyze|chart|graphs?|dashboard|trends?|breakdown|overview|insights?|comparison|compare)\b/.test(
    normalized,
  );
}

const COMPLETED_PURCHASE =
  /\b(bought|i paid|paid for|purchased|got it for|picked up|spent|da mua|vua mua|mua roi|da tra)\b/;
const PLAN_INTENT =
  /\b(want to|planning|thinking of|should i|can i afford|going to|will buy|muon mua|dinh mua|sap mua)\b/;

/** True when the user is reporting a purchase that already happened. Intent wording returns false. */
export function looksLikeCompletedPurchase(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!normalized) return false;
  if (COMPLETED_PURCHASE.test(normalized)) return true;
  if (PLAN_INTENT.test(normalized)) return false;
  return false;
}

/** True only for explicit future-buy wording, not a completed purchase. */
export function hasExplicitPlanIntent(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!normalized || looksLikeCompletedPurchase(message)) return false;
  return PLAN_INTENT.test(normalized);
}

function looksLikeDeclarativePurchase(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!normalized) return false;
  if (message.includes("?")) return false;
  if (looksLikeLedgerLookupRequest(message)) return false;
  return /\b(i spent|i bought|i paid|i purchased|just spent|just bought|charged|vua mua|da mua|da chi tien|log this|add this|record this|log my|record my|add my|enter my)\b/.test(
    normalized,
  );
}

/** User is stating new income to save — not asking to search existing ledger rows. */
function looksLikeDeclarativeIncomeEntry(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!normalized) return false;
  if (message.includes("?")) return false;
  if (looksLikeLedgerLookupRequest(message)) return false;

  if (
    /\b(i got paid|got paid|paid me|employer paid|i received my|i received a|received my|received a)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(my salary|my paycheck|my pay from|salary from|paycheck from|payroll from|wages from|net pay from|gross pay from)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(log|record|add|enter|save)\s+(my\s+)?(salary|paycheck|payroll|wages|income|bonus|commission|pay stub|paystub)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  const hasAmount = /\$?\d[\d,]*(?:\.\d{1,2})?|\d+\s*(cad|usd|vnd)\b/i.test(message);
  if (hasAmount && /\b(salary|paycheck|net pay|gross pay|payroll|wages|bonus|commission)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function looksLikeDeclarativeLedgerEntry(message: string): boolean {
  return looksLikeDeclarativePurchase(message) || looksLikeDeclarativeIncomeEntry(message);
}

export function looksLikeTemporalLookupRequest(message: string): boolean {
  const normalized = normalizeQueryText(message);
  return /\b(when did i|when have i|when was i|when was the|when was my|when is my|what date|what mileage|what odometer|last time i|most recent|lan cuoi|khi nao|ngay nao)\b/.test(
    normalized,
  );
}

export function looksLikeLedgerLookupRequest(message: string): boolean {
  const normalized = normalizeQueryText(message);
  if (!normalized) return false;

  if (message.includes("?")) return true;

  if (looksLikeTemporalLookupRequest(message)) return true;

  if (
    /\b(how much|how many|show me|show my|find my|find all|list my|list all|search my|search for|lookup|look up|look at|what did i|what have i|what was my|did i spend|have i spent|any transactions|where did i|when did i|pull up|get my|see my|view my|check my|my spending|my expenses|my transactions|my purchases|my payments|my data|my ledger|current data|from my ledger|in my ledger|in my account|in my wallet|last oil change|oil change for|cannot find|can't find|can not find)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /\b(bao nhieu|tim kiem|tim giao dich|hien thi|danh sach|da chi bao nhieu|co giao dich|xem du lieu|du lieu hien tai|trong so sach|trong vi|trong tai khoan)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/\b(do we have|do i have|did i|have i|is there|any data|any record)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function stripTimeTokens(searchTerms: string[], timeRange: { label: string } | null): string[] {
  if (!timeRange) return searchTerms;
  const timeTokens = new Set(
    normalizeQueryText(timeRange.label)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
  const monthTokens = new Set([
    "jan",
    "january",
    "feb",
    "february",
    "mar",
    "march",
    "apr",
    "april",
    "may",
    "jun",
    "june",
    "jul",
    "july",
    "aug",
    "august",
    "sep",
    "sept",
    "september",
    "oct",
    "october",
    "nov",
    "november",
    "dec",
    "december",
  ]);
  return searchTerms.filter((term) => !timeTokens.has(term) && !monthTokens.has(term) && !/^20\d{2}$/.test(term));
}

function defaultBrowseTimeRange(): { from: Date; to: Date; label: string } {
  return {
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
    label: "last 30 days",
  };
}

export function parseLedgerQuery(
  message: string,
  categories: LedgerCategoryRow[],
  wallets: LedgerWalletRow[],
): ParsedLedgerQuery | null {
  if (looksLikeDeclarativeLedgerEntry(message)) return null;

  const normalized = normalizeQueryText(message);
  const concreteAmountQuestion =
    /\b(how much|how many|what did i|did i spend|have i spent|bao nhieu)\b/.test(normalized) || message.includes("?");
  if (looksLikeAnalyticsOnlyRequest(message) && !concreteAmountQuestion) return null;

  const timeRange = parseTimeRange(message);
  const categoryScope = resolveAnalyticsCategoryScope(categories, message);
  let categoryIdSet = new Set(categoryScope?.categoryIds ?? []);
  let categoryLabel = categoryScope?.categoryLabel ?? null;
  if (categoryScope) {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const selectedParents = new Set(
      categoryScope.categoryIds
        .map((id) => byId.get(id))
        .filter((category): category is LedgerCategoryRow => category != null && !category.parentId)
        .map((category) => category.id),
    );
    for (const child of categories) {
      if (child.parentId && selectedParents.has(child.parentId)) {
        categoryIdSet.add(child.id);
      }
    }
  }
  const { walletIds, walletLabel } = selectWalletScope(wallets, message);
  const direction = parseDirection(message);
  const searchPhrases = extractSearchPhrases(message);
  let searchTerms = stripTokensCoveredByPhrases(
    removeScopeTerms(extractSearchTerms(message), [categoryLabel, walletLabel]),
    searchPhrases,
  );

  if (searchTerms.length > 0 && categoryLabel) {
    const categoryNorm = normalizeQueryText(categoryLabel);
    const explicitCategory =
      normalized.includes(categoryNorm) ||
      categoryNorm.split(" ").every((token) => token.length >= 3 && normalized.includes(token));
    if (!explicitCategory) {
      categoryIdSet = new Set<string>();
      categoryLabel = null;
      searchTerms = removeScopeTerms(extractSearchTerms(message), [walletLabel]);
    }
  }

  const categoryIds = [...categoryIdSet];
  const lookupIntent = looksLikeLedgerLookupRequest(message);
  const amountIntent =
    /\b(spend|spent|spending|expense|expenses|total|how much|how many|income|earned|earnings|revenue|bao nhieu|tieu|chi phi|thu nhap|doanh thu)\b/.test(
      normalized,
    );
  const browseIntent = /\b(find|list|show|search|filter|any|transactions?|purchases?|payments?|records?)\b/.test(normalized);
  const bareSearchIntent =
    searchTerms.length >= 1 &&
    !amountIntent &&
    !looksLikeDeclarativeLedgerEntry(message) &&
    normalized.split(" ").length <= 10;

  const hasScope =
    timeRange !== null ||
    categoryIds.length > 0 ||
    walletIds.length > 0 ||
    searchTerms.length > 0 ||
    searchPhrases.length > 0;
  const spendIntent =
    amountIntent ||
    lookupIntent ||
    browseIntent ||
    bareSearchIntent ||
    searchPhrases.length > 0 ||
    categoryIds.length > 0 ||
    walletIds.length > 0;

  if (!spendIntent) return null;
  if (!hasScope && !lookupIntent && !browseIntent && !bareSearchIntent) return null;

  let effectiveTimeRange = timeRange;
  if (
    !effectiveTimeRange &&
    lookupIntent &&
    categoryIds.length === 0 &&
    walletIds.length === 0 &&
    searchTerms.length === 0 &&
    searchPhrases.length === 0
  ) {
    effectiveTimeRange = defaultBrowseTimeRange();
  }

  const filteredSearchTerms = stripTimeTokens(searchTerms, effectiveTimeRange);
  const temporalIntent = looksLikeTemporalLookupRequest(message);
  const questionKind: LedgerQuestionKind = temporalIntent
    ? "temporal"
    : amountIntent
      ? "amount"
      : "browse";
  const textMatchMode: "all" | "any" =
    questionKind === "amount" && !browseIntent ? "all" : "any";

  return {
    timeRange: effectiveTimeRange,
    categoryIds,
    categoryLabel,
    walletIds,
    walletLabel,
    searchPhrases,
    searchTerms: filteredSearchTerms,
    direction,
    questionKind,
    textMatchMode,
  };
}

function money(cents: number, currency: string): string {
  return formatMoneyFromCents(cents, currency, { signed: false });
}

function formatTransactionLine(tx: {
  occurredAt: Date;
  amountCents: number;
  merchant: string | null;
  memo: string | null;
  categoryName: string | null;
  walletName: string;
  currency: string;
}): string {
  const date = tx.occurredAt.toISOString().slice(0, 10);
  const label = tx.merchant ?? tx.memo ?? "Transaction";
  const category = tx.categoryName ?? "Uncategorized";
  return `${date} · ${label} · ${tx.walletName} · ${category} · ${money(tx.amountCents, tx.currency)}`;
}

export function transactionSearchHaystack(
  merchant: string | null,
  memo: string | null,
  categoryName?: string | null,
  walletName?: string | null,
): string {
  return normalizeQueryText(`${merchant ?? ""} ${memo ?? ""} ${categoryName ?? ""} ${walletName ?? ""}`);
}

/** Terms sent to Prisma — narrower than user tokens to avoid noisy broad OR matches. */
function sqlSearchTerms(query: ParsedLedgerQuery): string[] {
  const terms = new Set(query.searchTerms);
  if (query.searchPhrases.includes("oil change")) {
    terms.delete("change");
  }
  if (terms.has("ram") && terms.has("1500")) {
    const anchored = ["ram", "1500"];
    if (terms.has("oil") || query.searchPhrases.some((p) => p.includes("oil"))) {
      anchored.push("oil");
    }
    return anchored;
  }
  return [...terms];
}

function scoreTransactionRelevance(
  merchant: string | null,
  memo: string | null,
  query: ParsedLedgerQuery,
  categoryName?: string | null,
  walletName?: string | null,
): number {
  const haystack = transactionSearchHaystack(merchant, memo, categoryName, walletName);
  if (!haystack) return 0;

  let score = 0;
  let matchedTerms = 0;

  for (const phrase of query.searchPhrases) {
    if (!haystack.includes(phrase)) continue;
    if (phrase === "oil change") score += 90;
    else if (phrase === "oil and filter") score += 85;
    else if (phrase === "ram 1500") score += 70;
    else score += 55;
  }

  for (const term of query.searchTerms) {
    if (!haystack.includes(term)) continue;
    matchedTerms += 1;
    score += term.length >= 5 ? 18 : 12;
  }

  if (matchedTerms === query.searchTerms.length && query.searchTerms.length > 0) {
    score += 15;
  }

  const asksRam1500 =
    query.searchPhrases.includes("ram 1500") ||
    (query.searchTerms.includes("ram") && query.searchTerms.includes("1500"));
  if (asksRam1500 && (!haystack.includes("ram") || !haystack.includes("1500"))) {
    return 0;
  }

  const asksOil =
    query.searchPhrases.some((p) => p.includes("oil")) || query.searchTerms.includes("oil");
  if (asksOil) {
    if (!haystack.includes("oil")) return 0;
    if (query.searchPhrases.includes("oil change")) {
      if (haystack.includes("oil and filter")) score += 100;
      if (haystack.includes("oil change") && !haystack.includes("differential")) score += 90;
      if (haystack.includes("differential oil")) score -= 40;
    } else {
      if (haystack.includes("oil change")) score += 45;
      if (haystack.includes("oil and filter")) score += 40;
      if (haystack.includes("differential oil")) score += 20;
    }
    if (/\bramen\b/.test(haystack)) return 0;
  }

  return score;
}

type RankedLedgerTransaction = {
  id?: string;
  occurredAt: Date;
  amountCents: number;
  merchant: string | null;
  memo: string | null;
  categoryName: string | null;
  walletName: string;
  currency: string;
  direction?: string;
  matchScore: number;
};

function categoryDisplayName(category: { name: string; parent: { name: string } | null } | null): string {
  return category?.parent?.name
    ? `${category.parent.name} > ${category.name}`
    : category?.name ?? "Uncategorized";
}

function rankTransactionsForQuery(
  rows: Array<{
    id: string;
    occurredAt: Date;
    amountCents: number;
    merchant: string | null;
    memo: string | null;
    direction: string;
    wallet: { name: string };
    currency: string;
    category: { name: string; parent: { name: string } | null } | null;
  }>,
  query: ParsedLedgerQuery,
): RankedLedgerTransaction[] {
  const ranked = rows.map((tx) => {
    const categoryName = categoryDisplayName(tx.category);
    return {
      id: tx.id,
      occurredAt: tx.occurredAt,
      amountCents: tx.amountCents,
      merchant: tx.merchant,
      memo: tx.memo,
      categoryName,
      walletName: tx.wallet.name,
      currency: tx.currency,
      direction: tx.direction,
      matchScore: scoreTransactionRelevance(tx.merchant, tx.memo, query, categoryName, tx.wallet.name),
    };
  });

  const minScore =
    query.searchPhrases.length > 0
      ? 35
      : query.textMatchMode === "any" && query.searchTerms.length > 0
        ? query.searchTerms.length === 1
          ? 10
          : 15
        : 0;

  const filtered =
    minScore > 0
      ? ranked.filter((tx) => tx.matchScore >= minScore)
      : ranked;

  return filtered.sort(
    (a, b) => b.matchScore - a.matchScore || b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

export function buildLedgerQueryWhere(
  userId: string,
  displayCurrency: string,
  query: ParsedLedgerQuery,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {
    userId,
    status: { not: "rejected" },
    direction: query.direction,
  };

  if (query.direction !== "in") {
    where.currency = displayCurrency;
  }

  if (query.timeRange) {
    where.occurredAt = { gte: query.timeRange.from, lt: query.timeRange.to };
  }
  if (query.walletIds.length > 0) {
    where.walletId = { in: query.walletIds };
  }

  if (query.categoryIds.length > 0) {
    where.categoryId = { in: query.categoryIds };
  }

  const dbTerms = sqlSearchTerms(query);
  if (dbTerms.length > 0) {
    const termClauses = dbTerms.flatMap((term) => [
      { merchant: { contains: term } },
      { memo: { contains: term } },
    ]);
    if (query.textMatchMode === "any") {
      where.OR = termClauses;
    } else {
      where.AND = dbTerms.map((term) => ({
        OR: [{ merchant: { contains: term } }, { memo: { contains: term } }],
      }));
    }
  }

  return where;
}

export type LedgerSearchRow = {
  id: string;
  occurredAt: string;
  direction: string;
  amountCents: number;
  currency: string;
  merchant: string | null;
  memo: string | null;
  walletName: string;
  categoryName: string;
  matchScore?: number;
};

export type LedgerCurrencyTotal = {
  currency: string;
  cents: number;
};

export type LedgerQueryResult = {
  totalCents: number;
  totalsByCurrency: LedgerCurrencyTotal[];
  txCount: number;
  sampleLines: string[];
  scopeLabel: string;
  transactions: LedgerSearchRow[];
};

export type LedgerPlanHit = {
  id: string;
  title: string;
  description: string | null;
  amountCents: number | null;
  currency: string;
};

export type LedgerSearchResponse = {
  query: ParsedLedgerQuery;
  result: LedgerQueryResult;
  formattedText: string;
  plans: LedgerPlanHit[];
};

function sortCurrencyTotals(totals: LedgerCurrencyTotal[], displayCurrency: string): LedgerCurrencyTotal[] {
  return [...totals].sort((a, b) => {
    if (a.currency === displayCurrency && b.currency !== displayCurrency) return -1;
    if (b.currency === displayCurrency && a.currency !== displayCurrency) return 1;
    return b.cents - a.cents || a.currency.localeCompare(b.currency);
  });
}

function totalsFromRows(rows: Array<{ currency: string; amountCents: number }>, displayCurrency: string): LedgerCurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = row.currency.toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + row.amountCents);
  }
  return sortCurrencyTotals(
    [...totals.entries()].map(([currency, cents]) => ({ currency, cents })),
    displayCurrency,
  );
}

function primaryTotalCents(totals: LedgerCurrencyTotal[], displayCurrency: string): number {
  return totals.find((row) => row.currency === displayCurrency)?.cents ?? (totals.length === 1 ? totals[0].cents : 0);
}

function formatCurrencyTotals(totals: LedgerCurrencyTotal[], fallbackCurrency: string, fallbackCents: number): string {
  if (totals.length === 0) return money(fallbackCents, fallbackCurrency);
  return totals.map((row) => money(row.cents, row.currency)).join(" and ");
}

export async function executeLedgerQuery(
  db: PrismaClient,
  input: {
    userId: string;
    displayCurrency: string;
    query: ParsedLedgerQuery;
    sampleLimit?: number;
  },
): Promise<LedgerQueryResult> {
  const where = buildLedgerQueryWhere(input.userId, input.displayCurrency, input.query);
  const sampleLimit = input.sampleLimit ?? 8;

  const [transactions, totalsByCurrencyRows, txCount] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      take: 200,
      include: { wallet: true, category: { include: { parent: true } } },
    }),
    db.transaction.groupBy({
      by: ["currency"],
      where,
      _sum: { amountCents: true },
    }),
    db.transaction.count({ where }),
  ]);

  const ranked = rankTransactionsForQuery(transactions, input.query);
  const usesRankedFilter =
    input.query.searchPhrases.length > 0 ||
    (input.query.textMatchMode === "any" && input.query.searchTerms.length > 0);
  const effectiveCount = usesRankedFilter ? ranked.length : txCount;
  const totalsByCurrency = usesRankedFilter
    ? totalsFromRows(ranked, input.displayCurrency)
    : sortCurrencyTotals(
        totalsByCurrencyRows.map((row) => ({
          currency: row.currency.toUpperCase(),
          cents: row._sum.amountCents ?? 0,
        })),
        input.displayCurrency,
      );
  const effectiveTotalCents = primaryTotalCents(totalsByCurrency, input.displayCurrency);

  const scopeParts: string[] = [];
  if (input.query.walletLabel) scopeParts.push(input.query.walletLabel);
  if (input.query.categoryLabel) scopeParts.push(input.query.categoryLabel);
  if (input.query.searchPhrases.length > 0) {
    scopeParts.push(input.query.searchPhrases.join(" · "));
  } else if (input.query.searchTerms.length > 0) {
    scopeParts.push(input.query.searchTerms.join(" "));
  }
  if (input.query.timeRange) scopeParts.push(input.query.timeRange.label);
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(" · ") : "matching transactions";

  const sampleLines = ranked.slice(0, sampleLimit).map((tx) => formatTransactionLine(tx));

  const searchTransactions: LedgerSearchRow[] = ranked.slice(0, 50).map((tx) => ({
    id: tx.id!,
    occurredAt: tx.occurredAt.toISOString(),
    direction: tx.direction ?? input.query.direction,
    amountCents: tx.amountCents,
    currency: tx.currency,
    merchant: tx.merchant,
    memo: tx.memo,
    walletName: tx.walletName,
    categoryName: tx.categoryName ?? "Uncategorized",
    matchScore: tx.matchScore,
  }));

  return {
    totalCents: effectiveTotalCents,
    totalsByCurrency,
    txCount: effectiveCount,
    sampleLines,
    scopeLabel,
    transactions: searchTransactions,
  };
}

export function formatLedgerQueryResponse(
  query: ParsedLedgerQuery,
  result: LedgerQueryResult,
  displayCurrency: string,
  responseLanguage: "English" | "Vietnamese" = "English",
): string {
  const scope = result.scopeLabel;

  if (result.txCount === 0) {
    const hint =
      query.direction === "in"
        ? responseLanguage === "Vietnamese"
          ? " Nếu bạn đã ghi khoản này, hãy thử hỏi theo tên công ty trả lương hoặc mở rộng khoảng thời gian."
          : " If you logged this already, try the employer name or a wider date range."
        : responseLanguage === "Vietnamese"
          ? " Nếu bạn đã ghi khoản này, hãy thử thêm ghi chú có tên địa điểm hoặc xe (ví dụ “Ram 1500 oil change”)."
          : " If you logged this already, try adding a memo with the shop or vehicle (e.g. “Ram 1500 oil change”).";
    return responseLanguage === "Vietnamese"
      ? `Mình không tìm thấy giao dịch nào phù hợp với ${scope} trong sổ của bạn.${hint}`
      : `I couldn't find any transactions matching ${scope} in your ledger.${hint}`;
  }

  if (query.questionKind === "temporal" && result.sampleLines.length > 0) {
    const oilChangeLines = result.sampleLines
      .filter((line) => {
        const lower = line.toLowerCase();
        return (
          lower.includes("oil change") ||
          lower.includes("oil and filter") ||
          (lower.includes("oil") && lower.includes("ram") && lower.includes("1500"))
        );
      })
      .sort((a, b) => {
        const rank = (line: string) => {
          const lower = line.toLowerCase();
          if (lower.includes("oil and filter")) return 4;
          if (lower.includes("oil change") && !lower.includes("differential")) return 3;
          if (lower.includes("differential oil")) return 1;
          return 2;
        };
        return rank(b) - rank(a);
      });
    const linesToUse =
      query.searchPhrases.includes("oil change") && oilChangeLines.length > 0
        ? oilChangeLines
        : result.sampleLines;
    const latest = linesToUse[0];
    const latestDate = latest.split(" · ")[0] ?? latest;
    let response =
      responseLanguage === "Vietnamese"
        ? `Giao dịch gần nhất liên quan đến ${scope} là ngày ${latestDate}.`
        : `Your most recent match for ${scope} was on ${latestDate}.`;
    const detailLabel = responseLanguage === "Vietnamese" ? "Chi tiết:" : "Details:";
    response += ` ${detailLabel} ${latest}`;
    if (linesToUse.length > 1) {
      const othersLabel = responseLanguage === "Vietnamese" ? "Các lần trước:" : "Earlier matches:";
      response += ` ${othersLabel} ${linesToUse.slice(1, 5).join(" | ")}`;
      const remaining = linesToUse.length - Math.min(5, linesToUse.length);
      if (remaining > 0 && result.txCount > linesToUse.length) {
        response +=
          responseLanguage === "Vietnamese"
            ? ` | ...và ${result.txCount - linesToUse.length} giao dịch nữa.`
            : ` | ...and ${result.txCount - linesToUse.length} more.`;
      }
    }
    if (
      query.searchPhrases.includes("oil change") &&
      oilChangeLines.length > 0 &&
      !latest.toLowerCase().includes("differential")
    ) {
      const diffLine = result.sampleLines.find((l) => l.toLowerCase().includes("differential oil"));
      if (diffLine) {
        const diffDate = diffLine.split(" · ")[0];
        response +=
          responseLanguage === "Vietnamese"
            ? ` (Bạn cũng có thay dầu cầu sau vào ${diffDate}.)`
            : ` (You also logged a differential oil service on ${diffDate}.)`;
      }
    }
    return response;
  }

  const amount = formatCurrencyTotals(result.totalsByCurrency, displayCurrency, result.totalCents);
  let response =
    query.direction === "in"
      ? responseLanguage === "Vietnamese"
        ? `Bạn đã nhận ${amount} từ ${scope}.`
        : `You received ${amount} from ${scope}.`
      : responseLanguage === "Vietnamese"
        ? `Bạn đã chi ${amount} cho ${scope}.`
        : `You spent ${amount} on ${scope}.`;

  const countLabel =
    responseLanguage === "Vietnamese"
      ? `Mình tìm thấy ${result.txCount} giao dịch phù hợp.`
      : `I found ${result.txCount} matching transaction${result.txCount === 1 ? "" : "s"}.`;
  response += ` ${countLabel}`;

  if (result.sampleLines.length > 0) {
    const recentLabel = responseLanguage === "Vietnamese" ? "Giao dịch gần đây:" : "Recent matches:";
    response += ` ${recentLabel} ${result.sampleLines.join(" | ")}`;
    if (result.txCount > result.sampleLines.length) {
      response +=
        responseLanguage === "Vietnamese"
          ? ` | ...và ${result.txCount - result.sampleLines.length} giao dịch nữa.`
          : ` | ...and ${result.txCount - result.sampleLines.length} more.`;
    }
  }

  return response;
}

/** Bounded recent rows for AI fallback when rule-based ledger parse does not run. */
export async function recentTransactionsContextBlock(
  db: PrismaClient,
  input: { userId: string; displayCurrency: string; limit?: number },
): Promise<string> {
  const limit = input.limit ?? 80;
  const rows = await db.transaction.findMany({
    where: {
      userId: input.userId,
      status: { not: "rejected" },
      currency: input.displayCurrency,
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: { wallet: true, category: { include: { parent: true } } },
  });
  if (rows.length === 0) return "";
  const lines = rows.map((tx) =>
    formatTransactionLine({
      occurredAt: tx.occurredAt,
      amountCents: tx.amountCents,
      merchant: tx.merchant,
      memo: tx.memo,
      categoryName: tx.category?.parent?.name
        ? `${tx.category.parent.name} > ${tx.category.name}`
        : tx.category?.name ?? "Uncategorized",
      walletName: tx.wallet.name,
      currency: tx.currency,
    }),
  );
  return [
    "RECENT LEDGER ROWS (newest first; use for lookup questions — do not invent rows not listed here):",
    ...lines,
  ].join("\n");
}

export async function searchLedger(
  db: PrismaClient,
  input: {
    userId: string;
    message: string;
    displayCurrency: string;
    responseLanguage?: "English" | "Vietnamese";
  },
): Promise<LedgerSearchResponse | null> {
  const categories = await db.category.findMany({
    where: { userId: input.userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
    },
  });
  const wallets = await db.wallet.findMany({
    where: { userId: input.userId },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  const query = parseLedgerQuery(input.message, categories, wallets);
  if (!query) return null;

  const result = await executeLedgerQuery(db, {
    userId: input.userId,
    displayCurrency: input.displayCurrency,
    query,
  });

  const plans = await searchMatchingPlans(db, input.userId, input.message);
  let formattedText = formatLedgerQueryResponse(
    query,
    result,
    input.displayCurrency,
    input.responseLanguage ?? "English",
  );
  if (plans.length > 0) {
    formattedText = `${formattedText}\n\n${
      result.txCount === 0
        ? formatPlannedPurchaseFallback(plans)
        : `PLANNED, NOT PURCHASED:\n${plans.map((plan) => `- ${plan.title}`).join("\n")}`
    }`;
  }

  return { query, result, formattedText, plans };
}

export function formatPlannedPurchaseFallback(plans: LedgerPlanHit[]): string {
  const bits = plans.map((plan) => {
    if (plan.amountCents == null) return plan.title;
    const major = plan.currency === "VND" || plan.currency === "JPY" ? String(plan.amountCents) : (plan.amountCents / 100).toFixed(2);
    return `${plan.title} (${major} ${plan.currency})`;
  });
  return `Not found in transactions, but you have a planned purchase: ${bits.join("; ")}.`;
}

export async function searchMatchingPlans(
  db: PrismaClient,
  userId: string,
  message: string,
): Promise<LedgerPlanHit[]> {
  const terms = extractSearchTerms(message);
  if (terms.length === 0) return [];
  const plans = await db.financialPlan.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
  return plans
    .filter((plan) => {
      const haystack = normalizeQueryText(`${plan.title} ${plan.description ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, 20)
    .map((plan) => ({
      id: plan.id,
      title: plan.title,
      description: plan.description,
      amountCents: plan.amountCents,
      currency: plan.currency,
    }));
}

export type WalletTransactionGroup = {
  walletId: string;
  walletName: string;
  sortOrder: number;
  expenseCents: number;
  incomeCents: number;
  transactions: LedgerSearchRow[];
};

/** Manual search for the transactions browser — optional text filter, grouped by wallet. */
export async function searchTransactionsGrouped(
  db: PrismaClient,
  input: {
    userId: string;
    displayCurrency: string;
    searchText?: string;
    limit?: number;
  },
): Promise<{ groups: WalletTransactionGroup[]; totalCount: number; displayCurrency: string; plans: LedgerPlanHit[] }> {
  const searchTerms = input.searchText?.trim()
    ? extractSearchTerms(input.searchText)
    : [];
  const limit = Math.min(input.limit ?? (searchTerms.length > 0 ? 5000 : 1000), 5000);

  const [wallets, rows] = await Promise.all([
    db.wallet.findMany({
      where: { userId: input.userId },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    db.transaction.findMany({
      where: {
        userId: input.userId,
        status: { not: "rejected" },
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { wallet: true, category: { include: { parent: true } } },
    }),
  ]);

  const filtered = rows.filter((tx) => {
    if (searchTerms.length === 0) return true;
    const categoryName = categoryDisplayName(tx.category);
    const haystack = transactionSearchHaystack(tx.merchant, tx.memo, categoryName, tx.wallet.name);
    return searchTerms.every((term) => haystack.includes(term));
  });

  const walletOrder = new Map(wallets.map((w, i) => [w.id, w.sortOrder ?? i]));
  const groupMap = new Map<string, WalletTransactionGroup>();

  for (const wallet of wallets) {
    groupMap.set(wallet.id, {
      walletId: wallet.id,
      walletName: wallet.name,
      sortOrder: wallet.sortOrder ?? 0,
      expenseCents: 0,
      incomeCents: 0,
      transactions: [],
    });
  }

  for (const tx of filtered) {
    let group = groupMap.get(tx.walletId);
    if (!group) {
      group = {
        walletId: tx.walletId,
        walletName: tx.wallet.name,
        sortOrder: walletOrder.get(tx.walletId) ?? 999,
        expenseCents: 0,
        incomeCents: 0,
        transactions: [],
      };
      groupMap.set(tx.walletId, group);
    }
    const categoryName = categoryDisplayName(tx.category);
    if (tx.direction === "in") group.incomeCents += tx.amountCents;
    else group.expenseCents += tx.amountCents;
    group.transactions.push({
      id: tx.id,
      occurredAt: tx.occurredAt.toISOString(),
      direction: tx.direction,
      amountCents: tx.amountCents,
      currency: tx.currency,
      merchant: tx.merchant,
      memo: tx.memo,
      walletName: tx.wallet.name,
      categoryName,
    });
  }

  const groups = [...groupMap.values()]
    .filter((g) => g.transactions.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.walletName.localeCompare(b.walletName));

  const plans = input.searchText?.trim() ? await searchMatchingPlans(db, input.userId, input.searchText) : [];

  return {
    groups,
    totalCount: filtered.length,
    displayCurrency: input.displayCurrency,
    plans,
  };
}

export async function tryAnswerLedgerQuery(
  db: PrismaClient,
  input: {
    userId: string;
    message: string;
    displayCurrency: string;
    responseLanguage?: "English" | "Vietnamese";
  },
): Promise<string | null> {
  const response = await searchLedger(db, input);
  return response?.formattedText ?? null;
}
