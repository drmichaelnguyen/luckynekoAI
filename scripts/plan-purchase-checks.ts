import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  extractSearchTerms,
  looksLikeCompletedPurchase,
  parseLedgerQuery,
} from "../src/lib/finance/ledger-query";
import { decidePlanSuggestion } from "../src/lib/finance/plan-suggestion";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function runPureChecks() {
  assert(looksLikeCompletedPurchase("I bought an 85mm 1.8 Nikkor lens for 220"), "bought");
  assert(looksLikeCompletedPurchase("Đã mua ống kính 85mm"), "da mua");
  assert(!looksLikeCompletedPurchase("I want to buy an 85mm lens for 220"), "intent is not completed");
  assert(decidePlanSuggestion("I bought an 85mm 1.8 Nikkor lens for 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    amountCents: 22000,
  }).kind === "transaction_draft", "draft not plan");
  assert(decidePlanSuggestion("I want to buy an 85mm lens for 220", {
    title: "Buy 85mm lens",
    amountCents: 22000,
  }).kind === "create_plan", "intent creates a plan");
  const bare = decidePlanSuggestion("85mm 1.8 Nikkor G Afs 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    amountCents: 22000,
  });
  assert(bare.kind === "ask_intent", "bare item asks");
  if (bare.kind === "ask_intent") {
    assert(bare.followUpQuestion.toLowerCase().includes("already buy"), "already bought");
    assert(bare.followUpQuestion.toLowerCase().includes("planning"), "planning");
  }
  const terms = extractSearchTerms("i bought a nikon lens 85mm");
  assert(terms.includes("nikon") && terms.includes("lens") && terms.includes("85mm") && !terms.includes("bought"), "search terms");
  const parsed = parseLedgerQuery("do we have data about i bought a nikon lens 85mm", [], []);
  assert(parsed !== null, "lookup is searched");
  console.log("pure checks passed");
}

async function main() {
  runPureChecks();
  const dir = mkdtempSync(path.join(tmpdir(), "neko-main-plans-"));
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
  const { searchTransactionsGrouped } = await import("../src/lib/finance/ledger-query");
  const db = new PrismaClient();
  const user = await db.user.create({
    data: { email: "plan-guard@example.com", passwordHash: "x", onboardingCompleted: true, preferredCurrency: "CAD" },
  });
  const other = await db.user.create({
    data: { email: "plan-guard-other@example.com", passwordHash: "x", onboardingCompleted: true },
  });
  const wallet = await db.wallet.create({
    data: { userId: user.id, name: "Main", kind: "spending", currency: "CAD", isDefault: true },
  });
  await db.category.create({ data: { userId: user.id, name: "Other", slug: "other", kind: "expense" } });

  const bought = await applyPlanSuggestion(db, user.id, "I bought an 85mm 1.8 Nikkor lens for 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    description: "Camera lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(bought.outcome === "draft", "db draft");
  assert((await db.financialPlan.count({ where: { userId: user.id } })) === 0, "no plan for bought");
  const draft = await db.transaction.findFirst({ where: { userId: user.id } });
  assert(draft?.status === "pending_user" && draft.amountCents === 22000, "pending 220");
  assert(draft?.merchant === "85mm 1.8 Nikkor G Afs lens", "merchant");

  const want = await applyPlanSuggestion(db, user.id, "I want to buy an 85mm lens for 220", {
    title: "Buy 85mm lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(want.outcome === "plan", "plan created");
  const bare = await applyPlanSuggestion(db, user.id, "85mm 1.8 Nikkor G Afs 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    amountCents: 22000,
  });
  assert(bare.outcome === "follow_up", "no auto plan");
  assert((await db.financialPlan.count({ where: { userId: user.id } })) === 1, "still one plan");

  await db.transaction.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      amountCents: 22000,
      direction: "out",
      currency: "CAD",
      merchant: "Nikon 85mm lens",
      memo: "Nikkor",
      occurredAt: new Date("2026-04-04T12:00:00.000Z"),
      status: "posted",
      source: "chat",
    },
  });
  const found = await searchTransactionsGrouped(db, {
    userId: user.id,
    displayCurrency: "CAD",
    searchText: "i bought a nikon lens 85mm",
  });
  assert(
    found.groups.some((group) => group.transactions.some((row) => (row.merchant ?? "").includes("85mm"))),
    "search finds 85mm",
  );

  const plan = await db.financialPlan.findFirstOrThrow({ where: { userId: user.id, title: "Buy 85mm lens" } });
  const rejected = await convertPlanToTransaction(db, other.id, plan.id);
  assert(!rejected.ok, "other user rejected");
  const converted = await convertPlanToTransaction(db, user.id, plan.id);
  assert(converted.ok, "converted");
  assert((await db.financialPlan.count({ where: { id: plan.id } })) === 0, "plan deleted");
  if (converted.ok) {
    const row = await db.transaction.findUniqueOrThrow({ where: { id: converted.transactionId } });
    assert(row.status === "posted" && row.merchant === "85mm lens" && row.source === "chat", "posted purchase");
  }
  console.log("plan purchase checks passed");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
