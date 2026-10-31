import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  expandSearchTerms,
  extractSearchTerms,
  morphologicalVariants,
  parseLedgerQuery,
  searchLedger,
} from "../src/lib/finance/ledger-query";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function runPureChecks() {
  assert(morphologicalVariants("photography").includes("photo"), "photography stems to photo");
  assert(extractSearchTerms("how much did i spent for photography").includes("photography"), "keeps photography");
  assert(!extractSearchTerms("how much did i spent for photography").includes("spent"), "drops spent");

  const expanded = expandSearchTerms(["photography"]);
  assert(expanded.usedExpansion, "photography expands");
  assert(expanded.topicTerms.includes("photography"), "keeps topic");
  assert(expanded.terms.includes("photo"), "adds photo");
  assert(expanded.terms.includes("camera"), "adds camera");
  assert(expanded.terms.includes("nikon"), "adds nikon");

  const parsed = parseLedgerQuery("how much did i spent for photography", [], []);
  assert(parsed !== null, "spend question parses");
  assert(parsed?.topicTerms.includes("photography"), "topic is photography");
  assert(parsed?.searchTerms.includes("photo"), "search includes photo");
  assert(parsed?.searchTerms.includes("camera"), "search includes camera");
  assert(parsed?.textMatchMode === "any", "expanded amount query ORs synonyms");

  const coffee = parseLedgerQuery("how much did I spend on coffee this month", [], []);
  assert(coffee?.searchTerms.includes("starbucks"), "coffee expands to starbucks");

  console.log("smart keyword pure checks passed");
}

async function runDbChecks() {
  const dir = mkdtempSync(path.join(tmpdir(), "neko-smart-kw-"));
  const databaseUrl = `file:${path.join(dir, "test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  execSync("./node_modules/.bin/prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const user = await db.user.create({
    data: {
      email: "photo-search@example.com",
      passwordHash: "x",
      onboardingCompleted: true,
      preferredCurrency: "CAD",
    },
  });
  const wallet = await db.wallet.create({
    data: { userId: user.id, name: "Main", kind: "spending", currency: "CAD", isDefault: true },
  });
  await db.category.create({
    data: { userId: user.id, name: "Entertainment", slug: "entertainment", kind: "expense" },
  });

  await db.transaction.createMany({
    data: [
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 45000,
        direction: "out",
        currency: "CAD",
        merchant: "Nikon Store",
        memo: "Z6 body",
        occurredAt: new Date("2026-03-12T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 8900,
        direction: "out",
        currency: "CAD",
        merchant: "Costco",
        memo: "photo prints for mom",
        occurredAt: new Date("2026-04-01T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 1200,
        direction: "out",
        currency: "CAD",
        merchant: "Starbucks",
        memo: "latte",
        occurredAt: new Date("2026-04-02T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
    ],
  });

  const found = await searchLedger(db, {
    userId: user.id,
    message: "how much did i spent for photography",
    displayCurrency: "CAD",
  });
  assert(found !== null, "photography search runs");
  assert((found?.result.txCount ?? 0) >= 2, "finds nikon + photo prints");
  assert(found?.result.scopeLabel.includes("photography"), "scope stays photography");
  assert(
    found?.result.transactions.some((tx) => (tx.merchant ?? "").includes("Nikon")),
    "includes Nikon",
  );
  assert(
    found?.result.transactions.some((tx) => (tx.memo ?? "").toLowerCase().includes("photo")),
    "includes photo prints",
  );
  assert(
    !found?.result.transactions.some((tx) => (tx.merchant ?? "").includes("Starbucks")),
    "does not include coffee",
  );

  console.log("smart keyword db checks passed");
  console.log("answer:\n", found?.formattedText);
  await db.$disconnect();
}

async function main() {
  runPureChecks();
  await runDbChecks();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
