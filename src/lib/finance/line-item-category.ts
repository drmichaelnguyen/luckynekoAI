import { inferCategoryFromMerchant, isWeakCategoryLabel, normalizeMerchantText } from "@/lib/finance/merchant-category-inference";

export type LineItemInput = {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
};

export type ReceiptCategorySplit = {
  description: string;
  category: string;
  amount: number;
  currency: string;
  direction: "out";
};

type ItemCategoryRule = {
  category: string;
  patterns: RegExp[];
};

const ITEM_CATEGORY_RULES: ItemCategoryRule[] = [
  {
    category: "Groceries > Supermarket",
    patterns: [
      /\b(milk|bread|egg|butter|cheese|yogurt|cream|meat|chicken|beef|pork|lamb|fish|salmon|tuna|shrimp|seafood|rice|pasta|noodle|ramen|banana|apple|orange|berry|grape|melon|vegetable|fruit|produce|grocery|organic|deli|bakery|flour|sugar|salt|oil|onion|garlic|tomato|potato|carrot|lettuce|spinach|broccoli|cabbage|cucumber|pepper|mushroom|avocado|lemon|lime|cereal|oat|granola|snack|chip|cracker|cookie|candy|chocolate|beverage|juice|soda|water|coffee|tea|frozen|ice\s*cream|tofu|kimchi|sauce|spice|herb|ham|bacon|sausage|turkey|duck|tofu|bean|lentil|nut|almond|walnut|honey|jam|ketchup|mustard|mayo|vinegar|soap\s*bar|dish\s*soap|laundry|detergent|paper\s*towel|toilet\s*paper|tissue|diaper|baby\s*food|pet\s*food)\b/,
      /\b(gao|thit|ca\b|rau|qua|trai|sua|banh|mi\b|tom\b|com\b|duong|muoi|dau\b|thuc\s*an|thuc\s*pham|bun\b|pho\b|cha\b|nem\b|gio\b|trung|bo\b|ga\b|heo\b)\b/,
    ],
  },
  {
    category: "Health > Pharmacy",
    patterns: [
      /\b(tylenol|advil|aspirin|ibuprofen|acetaminophen|vitamin|supplement|medicine|medication|prescription|pharmacy|bandage|gauze|thermometer|shampoo|conditioner|toothpaste|toothbrush|mouthwash|floss|deodorant|sunscreen|lotion|moisturizer|sanitizer|cold\s*flu|allergy|antacid|laxative|cough|inhaler)\b/,
      /\b(thuoc|vitamin|kem\s*dan\s*rang|dau\s*goi|xa\s*goi)\b/,
    ],
  },
  {
    category: "Shopping > Electronics",
    patterns: [
      /\b(iphone|ipad|macbook|laptop|computer|tablet|phone|charger|cable|headphone|earbud|airpod|speaker|tv\b|monitor|keyboard|mouse|usb|hdmi|ssd|hard\s*drive|router|modem|printer|ink\s*cartridge|battery|power\s*bank|camera|lens|drone|console|playstation|xbox|nintendo|switch)\b/,
    ],
  },
  {
    category: "Shopping > Clothing",
    patterns: [
      /\b(shirt|t\s*shirt|tee|pants|jeans|shorts|dress|skirt|jacket|coat|hoodie|sweater|cardigan|socks|underwear|boxer|bra|shoes|sneaker|boot|sandals|hat|cap|scarf|gloves|belt|apparel|clothing)\b/,
      /\b(ao\b|quan\b|vay\b|giay\b|dep\b)\b/,
    ],
  },
  {
    category: "Shopping > Home goods",
    patterns: [
      /\b(towel|sheet|pillow|blanket|mattress|curtain|rug|candle|lamp|bulb|tool|hammer|screw|drill|paint|storage|container|kitchenware|pan\b|pot\b|plate|bowl|cup|mug|utensil|fork|spoon|knife|cleaner|bleach|trash\s*bag)\b/,
    ],
  },
  {
    category: "Dining > Restaurant",
    patterns: [
      /\b(burger|pizza|sandwich|wrap|combo\s*meal|fries|nugget|wings|latte|espresso|cappuccino|mocha|donut|pastry|croissant|muffin|bagel|soup|salad\s*bar|appetizer|entree|dessert|tip\b|gratuity)\b/,
    ],
  },
  {
    category: "Dining > Delivery",
    patterns: [/\b(delivery\s*fee|service\s*fee|doordash|uber\s*eats|skip\s*the\s*dishes)\b/],
  },
  {
    category: "Transportation > Gas",
    patterns: [/\b(gasoline|petrol|diesel|fuel|unleaded|premium\s*gas)\b/],
  },
  {
    category: "Entertainment > Movies",
    patterns: [/\b(movie|cinema|theatre|theater|ticket|popcorn)\b/],
  },
  {
    category: "Bills & loans > Subscriptions",
    patterns: [/\b(subscription|membership\s*fee|monthly\s*fee|annual\s*fee)\b/],
  },
];

export function parseLineItems(value: unknown): LineItemInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      description: typeof row.description === "string" ? row.description : null,
      quantity: typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : null,
      unitPrice: typeof row.unitPrice === "number" && Number.isFinite(row.unitPrice) ? row.unitPrice : null,
      lineTotal: typeof row.lineTotal === "number" && Number.isFinite(row.lineTotal) ? row.lineTotal : null,
    }))
    .filter((item) => Boolean(item.description?.trim()));
}

function lineItemWeight(item: LineItemInput): number {
  if (item.lineTotal != null && item.lineTotal > 0) return item.lineTotal;
  if (item.unitPrice != null && item.quantity != null && item.unitPrice > 0 && item.quantity > 0) {
    return item.unitPrice * item.quantity;
  }
  if (item.unitPrice != null && item.unitPrice > 0) return item.unitPrice;
  if (item.quantity != null && item.quantity > 0) return item.quantity;
  return 1;
}

export function inferCategoryForItemDescription(description: string): string | null {
  const haystack = normalizeMerchantText(description);
  if (!haystack) return null;

  for (const rule of ITEM_CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.category;
    }
  }

  return null;
}

function inferCategoryForLineItem(item: LineItemInput, merchant?: string | null): string | null {
  const description = item.description?.trim();
  if (!description) return null;

  const fromDescription = inferCategoryForItemDescription(description);
  if (fromDescription) return fromDescription;

  return inferCategoryFromMerchant(merchant, description);
}

export function inferCategoryFromLineItems(
  lineItems: LineItemInput[],
  merchant?: string | null,
): string | null {
  if (lineItems.length === 0) return null;

  const tallies = new Map<string, number>();
  for (const item of lineItems) {
    const category = inferCategoryForLineItem(item, merchant);
    if (!category) continue;
    tallies.set(category, (tallies.get(category) ?? 0) + lineItemWeight(item));
  }

  if (tallies.size === 0) return null;

  return [...tallies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function inferReceiptSplitsFromLineItems(input: {
  lineItems: LineItemInput[];
  total?: number | null;
  currency?: string | null;
  merchant?: string | null;
}): ReceiptCategorySplit[] | null {
  const { lineItems, total, currency = "CAD", merchant } = input;
  if (lineItems.length === 0) return null;

  const groups = new Map<string, { weight: number; descriptions: string[] }>();
  let uncategorizedWeight = 0;

  for (const item of lineItems) {
    const description = item.description?.trim();
    if (!description) continue;

    const weight = lineItemWeight(item);
    const category = inferCategoryForLineItem(item, merchant);
    if (!category) {
      uncategorizedWeight += weight;
      continue;
    }

    const entry = groups.get(category) ?? { weight: 0, descriptions: [] };
    entry.weight += weight;
    entry.descriptions.push(description);
    groups.set(category, entry);
  }

  if (uncategorizedWeight > 0) {
    const fallback = inferCategoryFromMerchant(merchant) ?? inferCategoryFromLineItems(lineItems, merchant) ?? "Other";
    const entry = groups.get(fallback) ?? { weight: 0, descriptions: [] };
    entry.weight += uncategorizedWeight;
    if (entry.descriptions.length === 0) {
      entry.descriptions.push("Other items");
    }
    groups.set(fallback, entry);
  }

  if (groups.size <= 1) return null;

  const rawSum = [...groups.values()].reduce((sum, group) => sum + group.weight, 0);
  const targetTotal = total != null && total > 0 ? total : rawSum;
  const scale = rawSum > 0 ? targetTotal / rawSum : 1;

  const splits = [...groups.entries()].map(([category, group]) => ({
    description: group.descriptions.slice(0, 4).join(", "),
    category,
    amount: Math.round(group.weight * scale * 100) / 100,
    currency: (currency ?? "CAD").toUpperCase(),
    direction: "out" as const,
  }));

  if (total != null && total > 0 && splits.length > 0) {
    const splitSum = splits.reduce((sum, row) => sum + row.amount, 0);
    const delta = Math.round((total - splitSum) * 100) / 100;
    if (Math.abs(delta) >= 0.01) {
      splits[0].amount = Math.round((splits[0].amount + delta) * 100) / 100;
    }
  }

  return splits;
}

export function resolveTransactionCategory(input: {
  category?: string | null;
  merchant?: string | null;
  notes?: string | null;
  lineItems?: LineItemInput[] | unknown;
}): string | null {
  const explicit = input.category?.trim() || null;
  if (explicit && !isWeakCategoryLabel(explicit)) return explicit;

  const parsedLineItems = Array.isArray(input.lineItems) ? input.lineItems : parseLineItems(input.lineItems);
  const lineItems =
    parsedLineItems.length > 0
      ? parsedLineItems
      : input.notes?.trim()
        ? [{ description: input.notes.trim() }]
        : [];
  if (lineItems.length > 0) {
    const fromItems = inferCategoryFromLineItems(lineItems, input.merchant);
    if (fromItems) return fromItems;
  }

  const inferred = inferCategoryFromMerchant(input.merchant, input.notes);
  if (inferred) return inferred;

  return explicit;
}

export function enrichReceiptWithLineItemCategories(receipt: Record<string, unknown>): Record<string, unknown> {
  const lineItems = parseLineItems(receipt.lineItems);
  if (lineItems.length === 0) return receipt;

  const merchant = typeof receipt.merchant === "string" ? receipt.merchant : null;
  const currency = typeof receipt.currency === "string" ? receipt.currency : "CAD";
  const total = typeof receipt.total === "number" && Number.isFinite(receipt.total) ? receipt.total : null;

  const existingCategory =
    typeof receipt.category === "string"
      ? receipt.category
      : typeof receipt.categoryName === "string"
        ? receipt.categoryName
        : null;

  const fromItems = inferCategoryFromLineItems(lineItems, merchant);
  const next: Record<string, unknown> = { ...receipt };

  if (fromItems && (!existingCategory || existingCategory.trim().length === 0)) {
    next.category = fromItems;
  }

  const splits = inferReceiptSplitsFromLineItems({
    lineItems,
    total,
    currency,
    merchant,
  });
  if (splits) {
    next.receiptSplit = splits;
  }

  return next;
}
