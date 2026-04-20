import type { PrismaClient } from "@prisma/client";

export type MerchantHint = {
  merchant: string;
  categoryName: string;
  categorySlug: string;
  frequency: number;
  isRecurring: boolean;
};

export type SpendingPatternContext = {
  merchantHints: MerchantHint[];
  topCategoryNames: string[];
};

export async function loadSpendingPatterns(db: PrismaClient, userId: string): Promise<SpendingPatternContext> {
  try {
    // Load last 200 transactions with merchant + category
    const txRows = await db.transaction.findMany({
      where: {
        userId,
        status: { not: "rejected" },
        merchant: { not: null },
        categoryId: { not: null },
      },
      select: {
        merchant: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });

    // Group by merchant in-memory, find modal category per merchant
    const merchantMap = new Map<
      string,
      { categoryName: string; categorySlug: string; count: number; occurrences: string[] }
    >();

    for (const row of txRows) {
      const merchant = row.merchant!.toLowerCase().trim();
      const categoryName = row.category?.name ?? "Unknown";
      const categorySlug = row.category?.slug ?? "unknown";

      if (!merchantMap.has(merchant)) {
        merchantMap.set(merchant, { categoryName, categorySlug, count: 0, occurrences: [] });
      }
      const entry = merchantMap.get(merchant)!;
      entry.count++;
      entry.occurrences.push(categoryName);
    }

    // Convert to hints, sort by frequency, take top 20
    const hints: MerchantHint[] = Array.from(merchantMap.entries())
      .map(([merchant, data]) => {
        // Find modal category
        const categoryFreq = new Map<string, number>();
        for (const cat of data.occurrences) {
          categoryFreq.set(cat, (categoryFreq.get(cat) ?? 0) + 1);
        }
        const modalCategory = Array.from(categoryFreq.entries()).sort((a, b) => b[1] - a[1])[0];
        return {
          merchant,
          categoryName: modalCategory[0],
          categorySlug: data.categorySlug,
          frequency: data.count,
          isRecurring: data.count >= 3,
        };
      })
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20);

    // Load top 5 categories by spend volume
    const catSpend = await db.transaction.groupBy({
      by: ["categoryId"],
      where: { userId, direction: "out", status: { not: "rejected" } },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: "desc" } },
      take: 5,
    });

    const catIds = catSpend.map((s) => s.categoryId).filter(Boolean) as string[];
    const topCategories = catIds.length > 0
      ? await db.category.findMany({
          where: { id: { in: catIds } },
          select: { name: true },
        })
      : [];
    const topCategoryNames = topCategories.map((c) => c.name);

    return { merchantHints: hints, topCategoryNames };
  } catch (e) {
    console.error("[learning] loadSpendingPatterns failed", e);
    return { merchantHints: [], topCategoryNames: [] };
  }
}

export function buildSpendingPatternLines(ctx: SpendingPatternContext): string[] {
  if (ctx.merchantHints.length === 0 && ctx.topCategoryNames.length === 0) {
    return [];
  }

  const lines: string[] = ["LEARNED SPENDING PATTERNS (from transaction history — use these as defaults):"];

  if (ctx.merchantHints.length > 0) {
    lines.push("- Merchant → typical category:");
    for (const hint of ctx.merchantHints.slice(0, 10)) {
      const recurring = hint.isRecurring ? ", recurring" : "";
      lines.push(`  - ${hint.merchant} → ${hint.categoryName} (${hint.frequency}×${recurring})`);
    }
  }

  if (ctx.topCategoryNames.length > 0) {
    lines.push(`- Top spending categories: ${ctx.topCategoryNames.join(", ")}`);
  }

  return lines;
}

export function applyMerchantCategoryRule(
  structured: Record<string, unknown>,
  merchantHints: MerchantHint[],
): Record<string, unknown> {
  const merchant = structured.merchant;
  if (!merchant || typeof merchant !== "string") return structured;

  const merchantLower = merchant.toLowerCase().trim();
  const hint = merchantHints.find((h) => h.frequency >= 2 && h.merchant.toLowerCase() === merchantLower);

  if (hint) {
    return {
      ...structured,
      category: hint.categoryName,
    };
  }

  return structured;
}
