import type { PlanKind, PlanPeriod, PrismaClient, WalletKind } from "@prisma/client";

import { slugify } from "@/lib/finance/slug";

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
  return delegate.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

const DEFAULT_WALLET_NAMES = ["Main", "Savings", "Credit card"] as const;

const DEFAULT_WALLET_KINDS: WalletKind[] = ["spending", "savings", "credit"];

const DEFAULT_CATEGORIES: Array<{ name: string; kind: "income" | "expense" | "transfer" }> = [
  { name: "Income", kind: "income" },
  { name: "Housing", kind: "expense" },
  { name: "Utilities", kind: "expense" },
  { name: "Groceries", kind: "expense" },
  { name: "Dining", kind: "expense" },
  { name: "Transport", kind: "expense" },
  { name: "Shopping", kind: "expense" },
  { name: "Health", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Bills & loans", kind: "expense" },
  { name: "Transfers", kind: "transfer" },
  { name: "Other", kind: "expense" },
];

export async function ensureCategorySeed(db: PrismaClient, userId: string): Promise<void> {
  const catCount = await db.category.count({ where: { userId } });
  if (catCount > 0) return;
  await db.category.createMany({
    data: DEFAULT_CATEGORIES.map((c, i) => ({
      userId,
      name: c.name,
      slug: slugify(c.name),
      kind: c.kind,
      sortOrder: i,
    })),
  });
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
  await ensureFinanceSeed(db, userId);
  const [user, wallets, categories, plans] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, nickname: true },
    }),
    db.wallet.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, currency: true, isDefault: true },
    }),
    db.category.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true, kind: true, slug: true },
    }),
    loadFinancialPlansForContext(db, userId),
  ]);

  const address = user?.nickname?.trim() || user?.name?.trim() || "Friend";
  const prefLines = [
    "USER PREFERENCES:",
    `- Address the user naturally as "${address}" in assistantMessage (nickname if set, otherwise name).`,
    `- Display name on file: ${user?.name ?? "(not set)"}`,
  ];

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

  const wLines = wallets.map(
    (w) =>
      `- ${w.name} (${w.kind}, ${w.currency}${w.isDefault ? ", default" : ""}) [id:${w.id.slice(0, 8)}…]`,
  );
  const cLines = categories.map((c) => `- ${c.name} (${c.kind}, slug:${c.slug})`);
  return [
    ...prefLines,
    "",
    "USER LEDGER CONTEXT (use wallet NAME and category NAME from lists; never invent wallet names).",
    "WALLETS:",
    ...wLines,
    "CATEGORIES:",
    ...cLines,
    "",
    ...planLines,
  ].join("\n");
}
