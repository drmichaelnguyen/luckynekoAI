import type { PlanKind, PlanPeriod, PrismaClient, WalletKind } from "@prisma/client";

import { buildExchangeRateContext } from "@/lib/finance/exchange-rates";
import { slugify } from "@/lib/finance/slug";
import { loadAdminRuntimeSettings } from "@/lib/admin-runtime-settings";
import { findUserNameAndNicknameById } from "@/lib/prisma/user-select-compat";
import { loadSpendingPatterns, buildSpendingPatternLines } from "@/lib/learning/spending-patterns";
import { loadCorrectionExamples, buildCorrectionExamplesLines } from "@/lib/learning/correction-examples";
import { loadChatPreferences } from "@/lib/learning/chat-preferences";

/** Shape used when building chat finance context (keeps us typed if Prisma client is stale). */
type FinancialPlanContextRow = {
  kind: PlanKind;
  title: string;
  description: string | null;
  amountCents: number | null;
  currency: string;
  period: PlanPeriod;
  targetDate: Date | null;
};

async function loadFinancialPlansForContext(
  db: PrismaClient,
  userId: string,
): Promise<FinancialPlanContextRow[]> {
  const delegate = (db as unknown as { financialPlan?: { findMany: (args: unknown) => Promise<FinancialPlanContextRow[]> } })
    .financialPlan;
  if (!delegate?.findMany) {
    console.error(
      "[nekozen] Prisma client has no `financialPlan` model (outdated @prisma/client). Run `npx prisma generate`, restart the dev server, and ensure the DB schema is applied (`npx prisma db push` or migrate).",
    );
    return [];
  }
  try {
    return await delegate.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  } catch (e) {
    console.error(
      "[nekozen] financialPlan.findMany failed (schema out of date or DB error). Run migrations / prisma db push.",
      e,
    );
    return [];
  }
}

const DEFAULT_WALLET_NAMES = ["Main", "Savings", "Credit card"] as const;

const DEFAULT_WALLET_KINDS: WalletKind[] = ["spending", "savings", "credit"];

const DEFAULT_CATEGORY_TREE: Array<{
  name: string;
  kind: "income" | "expense" | "transfer";
  children?: string[];
}> = [
  { name: "Income", kind: "income", children: ["Salary", "Bonus", "Refund", "Interest", "Other income"] },
  { name: "Housing", kind: "expense", children: ["Rent", "Mortgage", "Maintenance", "Furniture"] },
  { name: "Utilities", kind: "expense", children: ["Electricity", "Water", "Internet", "Phone"] },
  { name: "Groceries", kind: "expense", children: ["Supermarket", "Convenience store", "Specialty food"] },
  { name: "Dining", kind: "expense", children: ["Restaurant", "Cafe", "Delivery", "Takeout"] },
  { name: "Transportation", kind: "expense", children: ["Flight", "Gas", "Bus", "Train", "Taxi", "Parking", "Tolls"] },
  { name: "Shopping", kind: "expense", children: ["Clothing", "Electronics", "Home goods", "Gifts"] },
  { name: "Health", kind: "expense", children: ["Pharmacy", "Doctor", "Dental", "Fitness"] },
  { name: "Entertainment", kind: "expense", children: ["Movies", "Music", "Games", "Events"] },
  { name: "Bills & loans", kind: "expense", children: ["Insurance", "Loan payment", "Credit card", "Subscriptions"] },
  { name: "Transfers", kind: "transfer", children: ["Savings transfer", "Credit card payment", "Internal transfer"] },
  { name: "Other", kind: "expense", children: ["Miscellaneous"] },
];

export async function ensureCategorySeed(db: PrismaClient, userId: string): Promise<void> {
  const existing = await db.category.findMany({
    where: { userId },
    select: { id: true, slug: true, name: true, parentId: true },
  });
  const bySlug = new Map(existing.map((category) => [category.slug, category]));

  let sortOrder = 0;
  for (const group of DEFAULT_CATEGORY_TREE) {
    const parentSlug = slugify(group.name);
    let parent = bySlug.get(parentSlug);
    if (!parent) {
      parent = await db.category.create({
        data: {
          userId,
          name: group.name,
          slug: parentSlug,
          kind: group.kind,
          sortOrder: sortOrder++,
        },
        select: { id: true, slug: true, name: true, parentId: true },
      });
      bySlug.set(parent.slug, parent);
    }

    for (const childName of group.children ?? []) {
      const childSlug = slugify(`${group.name}-${childName}`);
      if (bySlug.has(childSlug)) continue;
      const child = await db.category.create({
        data: {
          userId,
          name: childName,
          slug: childSlug,
          kind: group.kind,
          parentId: parent.id,
          sortOrder: sortOrder++,
        },
        select: { id: true, slug: true, name: true, parentId: true },
      });
      bySlug.set(child.slug, child);
    }
  }
}

function walletKindsForCount(n: number): WalletKind[] {
  if (n <= 1) return ["spending"];
  if (n === 2) return ["spending", "savings"];
  const out: WalletKind[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i === 0) out.push("spending");
    else if (i === n - 1) out.push("credit");
    else if (i === 1) out.push("savings");
    else out.push("other");
  }
  return out;
}

/**
 * Replace all wallets for a user (only safe when there are no transactions, enforced by caller).
 */
export async function replaceUserWallets(
  db: PrismaClient,
  userId: string,
  input: { names: string[]; currency: string },
): Promise<void> {
  const names = input.names.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return;

  await db.wallet.deleteMany({ where: { userId } });
  const kinds = walletKindsForCount(names.length);

  await db.wallet.createMany({
    data: names.map((name, i) => ({
      userId,
      name,
      kind: kinds[i] ?? "spending",
      currency: input.currency.toUpperCase().slice(0, 3),
      isDefault: i === 0,
      sortOrder: i,
    })),
  });
}

export async function ensureFinanceSeed(db: PrismaClient, userId: string): Promise<void> {
  await ensureCategorySeed(db, userId);

  const walletCount = await db.wallet.count({ where: { userId } });
  if (walletCount > 0) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { preferredCurrency: true },
  });
  const currency = (user?.preferredCurrency ?? "CAD").toUpperCase().slice(0, 3);

  await replaceUserWallets(db, userId, {
    names: [...DEFAULT_WALLET_NAMES],
    currency,
  });
}

export async function financeContextLines(db: PrismaClient, userId: string): Promise<string> {
  try {
    await ensureFinanceSeed(db, userId);
    const settings = await loadAdminRuntimeSettings();
    const [
      user,
      wallets,
      categories,
      plans,
      balanceGroups,
      userPrefs,
      spendingCtx,
      correctionExamples,
      chatPrefs,
      pendingConfirms,
    ] = await Promise.all([
      findUserNameAndNicknameById(db, userId),
      db.wallet.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, kind: true, currency: true, isDefault: true },
      }),
      db.category.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { name: true, kind: true, slug: true, parent: { select: { name: true } } },
      }),
      loadFinancialPlansForContext(db, userId),
      db.transaction.groupBy({
        by: ["walletId", "direction"],
        where: { userId, status: { not: "rejected" } },
        _sum: { amountCents: true },
      }).catch(() => [] as { walletId: string; direction: string; _sum: { amountCents: number | null } }[]),
      db.user.findUnique({ where: { id: userId }, select: { preferredCurrency: true } }),
      loadSpendingPatterns(db, userId, {
        enabled: settings.learning.enableMerchantLearning,
        minMerchantFrequency: settings.learning.merchantLearningMinFrequency,
      }),
      loadCorrectionExamples(db, userId, settings.learning.enableCorrectionLearning ? 3 : 0),
      settings.learning.enableChatPreferenceLearning ? loadChatPreferences(db, userId) : Promise.resolve(null),
      db.transaction.findMany({
        where: { userId, status: "pending_user" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          amountCents: true,
          currency: true,
          direction: true,
          merchant: true,
          memo: true,
          occurredAt: true,
          confirmReason: true,
        },
      }).catch(() => []),
    ]);

    const preferredCurrency = (userPrefs?.preferredCurrency ?? "CAD").toUpperCase();
    const fxContext = await buildExchangeRateContext(preferredCurrency);

    const walletNetMap = new Map<string, number>();
    for (const row of balanceGroups) {
      const prev = walletNetMap.get(row.walletId) ?? 0;
      const cents = row._sum.amountCents ?? 0;
      walletNetMap.set(row.walletId, prev + (row.direction === "in" ? cents : -cents));
    }

    const address = user?.nickname?.trim() || user?.name?.trim() || "Friend";
    const prefLines = [
      "USER PREFERENCES:",
      `- Address the user naturally as "${address}" in assistantMessage (nickname if set, otherwise name).`,
      `- Display name on file: ${user?.name ?? "(not set)"}`,
      `- Preferred currency: ${preferredCurrency}`,
    ];

    // Add chat preferences if detected
    if (settings.learning.enableChatPreferenceLearning && chatPrefs?.language === "vi") {
      prefLines.push(`- Language: Vietnamese — respond in Vietnamese unless user writes English first.`);
    } else if (settings.learning.enableChatPreferenceLearning && chatPrefs?.language === "en") {
      prefLines.push(`- Language: English — respond in English.`);
    }
    if (settings.learning.enableChatPreferenceLearning && chatPrefs?.verbosity === "concise") {
      prefLines.push(`- Response style: concise — keep replies short and direct.`);
    } else if (settings.learning.enableChatPreferenceLearning && chatPrefs?.verbosity === "detailed") {
      prefLines.push(`- Response style: detailed — explain thoroughly.`);
    }
    if (settings.learning.enableChatPreferenceLearning && (chatPrefs?.explicitInstructions?.length ?? 0) > 0) {
      prefLines.push(`- User-stated preferences:`);
      for (const inst of chatPrefs!.explicitInstructions) {
        prefLines.push(`  - "${inst}"`);
      }
    }

    const planLines =
      plans.length === 0
        ? ["FINANCIAL PLANS: (none — user can add spending or saving plans under Tools → Plans.)"]
        : [
            "FINANCIAL PLANS (respect when advising; amounts in cents when listed):",
            ...plans.map((p) => {
              const amt = p.amountCents != null ? `${p.amountCents} ${p.currency}` : "no fixed amount";
              const per = p.period !== "none" ? ` period:${p.period}` : "";
              const td = p.targetDate ? ` targetDate:${p.targetDate.toISOString().slice(0, 10)}` : "";
              const desc = p.description ? ` — ${p.description.slice(0, 240)}` : "";
              return `- [${p.kind}] ${p.title}: ${amt}${per}${td}${desc}`;
            }),
          ];

    const wLines = wallets.map((w) => {
      const netCents = walletNetMap.get(w.id);
      const balStr =
        netCents != null ? ` balance:${(netCents / 100).toFixed(2)} ${w.currency}` : "";
      return `- ${w.name} (${w.kind}, ${w.currency}${w.isDefault ? ", default" : ""}${balStr}) [id:${w.id.slice(0, 8)}…]`;
    });
    const cLines = categories.map((c) => {
      const label = c.parent?.name ? `${c.parent.name} > ${c.name}` : c.name;
      return `- ${label} (${c.kind}, slug:${c.slug})`;
    });

    const spendingLines = settings.learning.enableMerchantLearning ? buildSpendingPatternLines(spendingCtx) : [];
    const correctionLines = settings.learning.enableCorrectionLearning ? buildCorrectionExamplesLines(correctionExamples) : [];

    const pendingLines =
      pendingConfirms.length === 0
        ? []
        : [
            "PENDING CONFIRMATIONS (user has not yet decided if these repeat; if the user answers with a cadence in chat, return pendingRecurrenceUpdate):",
            ...pendingConfirms.map((p) => {
              const name = p.merchant || p.memo || "No description";
              const amt = `${p.currency} ${(p.amountCents / 100).toFixed(2)}`;
              const dir = p.direction === "out" ? "out" : "in";
              const date = p.occurredAt.toISOString().slice(0, 10);
              const reason = p.confirmReason ? ` · reason: ${p.confirmReason.slice(0, 120)}` : "";
              return `- ${name} · ${amt} ${dir} · ${date}${reason}`;
            }),
            "",
          ];

    return [
      ...prefLines,
      "",
      "USER LEDGER CONTEXT (use wallet NAME from the list; never invent wallet names. Prefer category NAMEs from the list, but you may propose a new category or a Parent > Child subcategory path if nothing fits well).",
      "WALLETS:",
      ...wLines,
      "CATEGORIES:",
      ...cLines,
      "",
      ...planLines,
      "",
      ...pendingLines,
      ...(spendingLines.length > 0 ? [...spendingLines, ""] : []),
      ...(correctionLines.length > 0 ? [...correctionLines, ""] : []),
      ...(fxContext ? [fxContext] : []),
    ].join("\n");
  } catch (e) {
    console.error("[nekozen] financeContextLines failed", e);
    return [
      "USER PREFERENCES:",
      "- Address the user naturally in assistantMessage.",
      "",
      "USER LEDGER CONTEXT (metadata could not be loaded; ask the user to retry or check Tools → account).",
      "WALLETS: (unavailable)",
      "CATEGORIES: (unavailable)",
      "",
      "FINANCIAL PLANS: (unavailable)",
    ].join("\n");
  }
}
