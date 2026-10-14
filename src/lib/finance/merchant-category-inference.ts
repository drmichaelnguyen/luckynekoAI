const WEAK_CATEGORY_LABELS = new Set([
  "other",
  "others",
  "misc",
  "miscellaneous",
  "unknown",
  "uncategorized",
]);

export function normalizeMerchantText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWeakCategoryLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  const normalized = normalizeMerchantText(label);
  if (!normalized) return true;
  if (WEAK_CATEGORY_LABELS.has(normalized)) return true;
  return normalized.startsWith("other ");
}

type MerchantCategoryRule = {
  test: RegExp;
  category: string;
};

const MERCHANT_CATEGORY_RULES: MerchantCategoryRule[] = [
  {
    test: /\b(super\s*market|supermart|grocery|groceries|food\s*mart|mega\s*mart|minimart|mini\s*mart|food\s*store)\b/,
    category: "Groceries > Supermarket",
  },
  {
    test: /\b(convenience\s*store|7\s*eleven|circle\s*k|couche\s*tard|depanneur|corner\s*store)\b/,
    category: "Groceries > Convenience store",
  },
  {
    test: /\b(costco|walmart|loblaws|nofrills|no\s*frills|freshco|safeway|sobeys|food\s*basics|whole\s*foods|save\s*on|superstore|provigo|maxi\b|iga\b|foodland|longos|farm\s*boy|real\s*canadian)\b/,
    category: "Groceries > Supermarket",
  },
  {
    test: /\b(t\s*&\s*t|tnt\b|h mart|hmart|asian\s*market|hong\s*kong\s*supermarket)\b/,
    category: "Groceries > Supermarket",
  },
  {
    test: /\b(sieu\s*thi|sieu\s*thị|cho\b|chợ|thuc\s*pham|thực\s*phẩm|banh\s*keo|bánh\s*kẹo|tap\s*hoa|tạp\s*hóa)\b/,
    category: "Groceries > Supermarket",
  },
  {
    test: /\b(restaurant|cafe|coffee|tim\s*hortons|starbucks|mcdonald|burger|pizza|sushi|pho\b|bistro|diner|pub\b|bar\s*&\s*grill|nha\s*hang|nhà\s*hàng)\b/,
    category: "Dining > Restaurant",
  },
  {
    test: /\b(uber\s*eats|doordash|skip\s*the\s*dishes|grubhub|deliveroo|foodpanda)\b/,
    category: "Dining > Delivery",
  },
  {
    test: /\b(shell\b|esso\b|petro\s*can|chevron|husky|pioneer\s*gas|gas\s*station|fuel|petrol)\b/,
    category: "Transportation > Gas",
  },
  {
    test: /\b(uber\b|lyft\b|taxi|cab\b|grab\b|be\b)\b/,
    category: "Transportation > Taxi",
  },
  {
    test: /\b(shoppers|pharmaprix|rexall|pharmacy|drug\s*mart)\b/,
    category: "Health > Pharmacy",
  },
  {
    test: /\b(amazon\b|best\s*buy|apple\s*store|staples\b|ikea\b|winners|homesense|dollarama|canadian\s*tire)\b/,
    category: "Shopping > Home goods",
  },
  {
    test: /\b(netflix|spotify|disney\s*plus|apple\s*music|youtube\s*premium|cloudflare|github)\b/,
    category: "Bills & loans > Subscriptions",
  },
];

export function inferCategoryFromMerchant(
  merchant: string | null | undefined,
  notes?: string | null,
): string | null {
  const haystack = normalizeMerchantText(`${merchant ?? ""} ${notes ?? ""}`);
  if (!haystack) return null;

  for (const rule of MERCHANT_CATEGORY_RULES) {
    if (rule.test.test(haystack)) return rule.category;
  }

  // Named stores that end in "market" / "mart" (e.g. "88 Super Market").
  if (/\b(market|mart)\b/.test(haystack) && !/\b(stock|farmers|flea|night)\s+market\b/.test(haystack)) {
    return "Groceries > Supermarket";
  }

  return null;
}
