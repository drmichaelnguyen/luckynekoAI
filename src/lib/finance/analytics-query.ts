type AnalyticsCategoryRow = {
  id?: string;
  categoryId?: string | null;
  name: string;
  parentId?: string | null;
};

type CategoryMatch = {
  row: AnalyticsCategoryRow;
  score: number;
};

export type AnalyticsCategoryScope = {
  categoryIds: string[];
  categoryLabel: string | null;
  matchedNames: string[];
};

function normalizeQueryText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addTerms(target: Set<string>, terms: string[]): void {
  for (const term of terms) {
    const normalized = normalizeQueryText(term);
    if (normalized) target.add(normalized);
  }
}

function semanticTermsForCategoryName(name: string): string[] {
  const normalized = normalizeQueryText(name);
  const terms = new Set<string>();
  addTerms(terms, [normalized]);

  const rules: Array<{ test: RegExp; terms: string[] }> = [
    { test: /\bincome\b|\bsalary\b|\bbonus\b|\brefund\b|\binterest\b|\bwages\b|\bpaycheck\b|\bpayroll\b/, terms: ["income", "salary", "bonus", "refund", "interest", "wages", "paycheck", "payroll", "deposit"] },
    { test: /\bhousing\b|\brent\b|\bmortgage\b|\bmaintenance\b|\bfurniture\b|\bhome\b|\bapartment\b/, terms: ["housing", "rent", "mortgage", "home", "apartment", "lease", "maintenance", "furniture"] },
    { test: /\butilities\b|\belectricity\b|\bwater\b|\binternet\b|\bphone\b|\bmobile\b/, terms: ["utilities", "utility", "bill", "electricity", "water", "internet", "phone", "mobile"] },
    { test: /\bgroceries\b|\bgrocery\b|\bsupermarket\b|\bconvenience store\b|\bspecialty food\b|\bfood\b/, terms: ["groceries", "grocery", "food", "supermarket", "market", "snack", "meal"] },
    { test: /\bdining\b|\brestaurant\b|\bcafe\b|\bdelivery\b|\btakeout\b/, terms: ["dining", "restaurant", "cafe", "coffee", "delivery", "takeout", "meal", "lunch", "dinner", "breakfast"] },
    { test: /\btransportation\b|\bflight\b|\bgas\b|\bbus\b|\btrain\b|\btaxi\b|\bparking\b|\btolls\b/, terms: ["transportation", "transport", "commute", "car", "ride", "uber", "lyft", "taxi", "cab", "flight", "gas", "fuel", "bus", "train", "parking", "tolls"] },
    { test: /\bshopping\b|\bclothing\b|\belectronics\b|\bhome goods\b|\bgifts\b/, terms: ["shopping", "shop", "clothing", "clothes", "electronics", "home goods", "gift", "gifts", "retail"] },
    { test: /\bhealth\b|\bpharmacy\b|\bdoctor\b|\bdental\b|\bfitness\b/, terms: ["health", "medical", "medicine", "pharmacy", "doctor", "dentist", "dental", "fitness", "gym"] },
    { test: /\bentertainment\b|\bmovies\b|\bmusic\b|\bgames\b|\bevents\b/, terms: ["entertainment", "movie", "movies", "music", "game", "games", "event", "events", "concert"] },
    { test: /\bbills\s*&\s*loans\b|\binsurance\b|\bloan payment\b|\bcredit card\b|\bsubscriptions\b/, terms: ["bills", "bills and loans", "loan", "insurance", "subscription", "subscriptions", "credit card", "bill", "recurring"] },
    { test: /\btransfers\b|\bsavings transfer\b|\bcredit card payment\b|\binternal transfer\b/, terms: ["transfer", "transfers", "savings", "credit card payment", "internal transfer"] },
    { test: /\bother\b|\bmisc\b|\bmiscellaneous\b/, terms: ["other", "misc", "miscellaneous"] },
  ];

  for (const rule of rules) {
    if (rule.test.test(normalized)) {
      addTerms(terms, rule.terms);
    }
  }

  return [...terms];
}

function scoreCategory(messageNorm: string, row: AnalyticsCategoryRow): number {
  const terms = semanticTermsForCategoryName(row.name);
  const tokens = messageNorm.split(" ").filter(Boolean);
  let score = 0;

  for (const term of terms) {
    if (!term) continue;
    if (messageNorm === term) score = Math.max(score, 100);
    if (
      messageNorm.includes(` ${term} `) ||
      messageNorm.startsWith(`${term} `) ||
      messageNorm.endsWith(` ${term}`) ||
      messageNorm.includes(term)
    ) {
      score = Math.max(score, 80 + Math.min(term.split(" ").length * 2, 10));
    }
    const matchedTokens = term.split(" ").filter((token) => tokens.includes(token)).length;
    if (matchedTokens > 0) {
      score = Math.max(score, matchedTokens * 10 + (row.parentId ? 2 : 0));
    }
  }

  return score;
}

export function resolveAnalyticsCategoryScope(categories: AnalyticsCategoryRow[], message: string): AnalyticsCategoryScope | null {
  const normalized = normalizeQueryText(message);
  if (!normalized) return null;

  const matches: CategoryMatch[] = [];
  for (const row of categories) {
    const score = scoreCategory(normalized, row);
    if (score >= 20) {
      matches.push({ row, score });
    }
  }

  if (matches.length === 0) return null;

  const bestScore = Math.max(...matches.map((match) => match.score));
  const selected = matches
    .filter((match) => match.score >= Math.max(20, bestScore - 12))
    .sort((a, b) => b.score - a.score);

  const categoryIds = new Set<string>();
  const matchedNames = new Set<string>();

  for (const match of selected) {
    const id = match.row.id ?? match.row.categoryId;
    if (typeof id === "string" && id.length > 0) {
      categoryIds.add(id);
    }
    matchedNames.add(match.row.name);
  }

  const label = selected[0]?.row.name ?? null;
  return {
    categoryIds: [...categoryIds],
    categoryLabel: label,
    matchedNames: [...matchedNames],
  };
}
