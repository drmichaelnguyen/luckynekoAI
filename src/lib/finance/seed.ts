import type { PrismaClient, WalletKind } from "@prisma/client";

import { slugify } from "@/lib/finance/slug";

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
  const wallets = await db.wallet.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, currency: true, isDefault: true },
  });
  const categories = await db.category.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, kind: true, slug: true },
  });
  const wLines = wallets.map(
    (w) =>
      `- ${w.name} (${w.kind}, ${w.currency}${w.isDefault ? ", default" : ""}) [id:${w.id.slice(0, 8)}…]`,
  );
  const cLines = categories.map((c) => `- ${c.name} (${c.kind}, slug:${c.slug})`);
  return [
    "USER LEDGER CONTEXT (use wallet NAME and category NAME from lists; never invent wallet names).",
    "WALLETS:",
    ...wLines,
    "CATEGORIES:",
    ...cLines,
  ].join("\n");
}
