import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runLedgerQueryChecks } from "./debug-ledger-query";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function main() {
  runLedgerQueryChecks();

  const dir = mkdtempSync(path.join(tmpdir(), "neko-plans-"));
  const databaseUrl = `file:${path.join(dir, "test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const { PrismaClient } = await import("@prisma/client");
  const { applyPlanSuggestion } = await import("../src/lib/finance/plan-suggestion");
  const { convertPlanToTransaction } = await import("../src/lib/finance/convert-plan");
  const { formatPlannedPurchaseFallback, searchLedgerText } = await import("../src/lib/finance/ledger-query");

  const db = new PrismaClient();
  const user = await db.user.create({
    data: {
      email: "plan-guard@example.com",
      passwordHash: "x",
      onboardingCompleted: true,
      preferredCurrency: "CAD",
    },
  });
  const other = await db.user.create({
    data: { email: "plan-guard-other@example.com", passwordHash: "x", onboardingCompleted: true },
  });
  await db.wallet.create({
    data: { userId: user.id, name: "Main", kind: "spending", currency: "CAD", isDefault: true },
  });
  await db.category.create({
    data: { userId: user.id, name: "Other", slug: "other", kind: "expense" },
  });

  const bought = await applyPlanSuggestion(db, user.id, "I bought an 85mm 1.8 Nikkor lens for 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    description: "Camera lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(bought.outcome === "draft", "bought message creates a transaction draft");
  assert((await db.financialPlan.count({ where: { userId: user.id } })) === 0, "bought message does not create a plan");
  const draft = await db.transaction.findFirst({ where: { userId: user.id } });
  assert(draft?.status === "pending_user", "draft waits for confirm");
  assert(draft?.amountCents === 22000, "draft amount is 220 dollars");
  assert(draft?.merchant === "85mm 1.8 Nikkor G Afs lens", "draft merchant drops Buy");
  assert(draft?.confirmReason?.includes("bought this"), "draft reason explains the guard");
  assert(draft?.memo === "Camera lens", "draft memo comes from the description");

  const want = await applyPlanSuggestion(db, user.id, "I want to buy an 85mm lens for 220", {
    title: "Buy 85mm lens",
    description: "Future lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(want.outcome === "plan", "intent creates a plan");
  assert((await db.financialPlan.count({ where: { userId: user.id } })) === 1, "one plan stored");
  assert((await db.transaction.count({ where: { userId: user.id } })) === 1, "intent does not add a transaction");

  const bare = await applyPlanSuggestion(db, user.id, "85mm 1.8 Nikkor G Afs 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(bare.outcome === "follow_up", "bare item asks a follow-up");
  if (bare.outcome === "follow_up") {
    assert(bare.followUpQuestion.toLowerCase().includes("already buy"), "follow-up mentions already bought");
    assert(bare.followUpQuestion.toLowerCase().includes("planning"), "follow-up mentions planning");
  }
  assert((await db.financialPlan.count({ where: { userId: user.id } })) === 1, "bare item creates no plan");

  await db.transaction.create({
    data: {
      userId: user.id,
      walletId: (await db.wallet.findFirstOrThrow({ where: { userId: user.id } })).id,
      amountCents: 180000,
      direction: "out",
      currency: "CAD",
      merchant: "Nikon 85mm lens",
      memo: "1.8 Nikkor",
      occurredAt: new Date("2026-04-04T12:00:00.000Z"),
      source: "chat",
      status: "posted",
    },
  });
  const found = await searchLedgerText(db, user.id, "i bought a nikon lens 85mm");
  assert(
    found.transactions.some((row) => (row.merchant ?? "").toLowerCase().includes("85mm")),
    "transactions search finds the 85mm purchase without requiring the word bought",
  );
  assert(found.transactions.every((row) => (row.merchant ?? "").toLowerCase() !== "cafe"), "unrelated rows stay out");

  const planOnly = await db.financialPlan.create({
    data: {
      userId: user.id,
      kind: "spending_budget",
      title: "Nikon 85mm lens trip",
      description: "Not purchased yet",
      amountCents: 50000,
      currency: "CAD",
    },
  });
  await db.transaction.deleteMany({ where: { userId: user.id, merchant: { contains: "85mm" } } });
  await db.transaction.deleteMany({ where: { userId: user.id, merchant: { contains: "Nikkor" } } });
  const plansOnly = await searchLedgerText(db, user.id, "i bought a nikon lens 85mm");
  assert(plansOnly.transactions.length === 0, "cleared transactions stay empty");
  assert(
    plansOnly.plans.some((plan) => plan.id === planOnly.id),
    "the same search finds the planned purchase",
  );
  const fallback = formatPlannedPurchaseFallback(plansOnly.plans);
  assert(fallback?.startsWith("Not found in transactions, but you have a planned purchase:"), "fallback copy");

  const plan = await db.financialPlan.findFirstOrThrow({ where: { userId: user.id, title: "Buy 85mm lens" } });
  const rejected = await convertPlanToTransaction(db, other.id, plan.id);
  assert(rejected.ok === false, "another user cannot convert the plan");
  assert((await db.financialPlan.count({ where: { id: plan.id } })) === 1, "rejected convert keeps the plan");
  assert((await db.transaction.count({ where: { userId: other.id } })) === 0, "rejected convert writes no transaction");

  const before = await db.transaction.count({ where: { userId: user.id } });
  const converted = await convertPlanToTransaction(db, user.id, plan.id);
  assert(converted.ok === true, "owner can mark the plan as bought");
  assert((await db.financialPlan.count({ where: { id: plan.id } })) === 0, "convert deletes the plan");
  assert((await db.transaction.count({ where: { userId: user.id } })) === before + 1, "convert creates one transaction");
  if (converted.ok) {
    const row = await db.transaction.findUniqueOrThrow({ where: { id: converted.transactionId } });
    assert(row.status === "posted", "converted purchase is posted");
    assert(row.source === "chat", "converted purchase is sourced from chat");
    assert(row.merchant === "85mm lens", "converted merchant drops Buy");
    assert(row.amountCents === 22000, "converted amount comes from the plan");
    assert(row.memo === "Future lens", "converted memo comes from the description");
  }

  console.log("agent harness passed");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
