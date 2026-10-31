import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expandTopicSearchTerms } from "../src/lib/finance/topic-search-expansions";
import {
  executeLedgerQuery,
  parseLedgerQuery,
  withExpandedSearchTerms,
} from "../src/lib/finance/ledger-query";

function runPureChecks() {
  const photo = expandTopicSearchTerms(["photography"]);
  assert.equal(photo.expanded, true);
  assert.ok(photo.topicTerms.includes("photography"));
  assert.ok(photo.terms.includes("nikon"));
  assert.ok(photo.terms.includes("adobe"));
  assert.ok(photo.terms.includes("lens"));
  assert.ok(photo.terms.includes("camera"));

  const coffee = expandTopicSearchTerms(["coffee"]);
  assert.equal(coffee.expanded, true);
  assert.ok(coffee.terms.includes("starbucks"));

  const literal = expandTopicSearchTerms(["costco"]);
  assert.equal(literal.expanded, false);
  assert.deepEqual(literal.terms, ["costco"]);

  const parsed = parseLedgerQuery("how much did i spent for photography", [], []);
  assert.ok(parsed, "photography amount question parses");
  assert.equal(parsed!.questionKind, "amount");
  assert.equal(parsed!.topicExpanded, true);
  assert.equal(parsed!.textMatchMode, "any");
  assert.ok(parsed!.topicTerms.includes("photography"));
  assert.ok(parsed!.searchTerms.includes("nikon"));
  assert.ok(parsed!.searchTerms.includes("adobe"));

  const uber = parseLedgerQuery("how much did i spend on uber", [], []);
  assert.ok(uber);
  assert.equal(uber!.topicExpanded, false);
  assert.equal(uber!.textMatchMode, "all");
  assert.deepEqual(uber!.searchTerms, ["uber"]);

  const merged = withExpandedSearchTerms(uber!, ["lyft", "grab"]);
  assert.equal(merged.topicExpanded, true);
  assert.equal(merged.textMatchMode, "any");
  assert.ok(merged.searchTerms.includes("lyft"));

  console.log("pure topic-search checks passed");
}

async function runDbChecks() {
  const dir = mkdtempSync(path.join(tmpdir(), "neko-topic-search-"));
  const databaseUrl = `file:${path.join(dir, "test.db")}`;
  process.env.DATABASE_URL = databaseUrl;
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const user = await db.user.create({
    data: {
      email: "topic-search@example.com",
      passwordHash: "x",
      onboardingCompleted: true,
      preferredCurrency: "CAD",
    },
  });
  const wallet = await db.wallet.create({
    data: {
      userId: user.id,
      name: "Main",
      kind: "spending",
      currency: "CAD",
      isDefault: true,
    },
  });

  await db.transaction.createMany({
    data: [
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 89900,
        direction: "out",
        currency: "CAD",
        merchant: "Nikon Store",
        memo: "85mm Nikkor lens",
        occurredAt: new Date("2026-03-01T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 1499,
        direction: "out",
        currency: "CAD",
        merchant: "Adobe",
        memo: "Lightroom subscription",
        occurredAt: new Date("2026-03-15T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
      {
        userId: user.id,
        walletId: wallet.id,
        amountCents: 2500,
        direction: "out",
        currency: "CAD",
        merchant: "Starbucks",
        memo: "latte",
        occurredAt: new Date("2026-03-10T12:00:00.000Z"),
        status: "posted",
        source: "chat",
      },
    ],
  });

  const query = parseLedgerQuery("how much did i spent for photography", [], [
    { id: wallet.id, name: wallet.name },
  ]);
  assert.ok(query);
  const result = await executeLedgerQuery(db, {
    userId: user.id,
    displayCurrency: "CAD",
    query: query!,
  });

  assert.equal(result.txCount, 2, `expected 2 photography rows, got ${result.txCount}`);
  assert.equal(result.totalCents, 89900 + 1499);
  assert.equal(result.scopeLabel, "photography");
  assert.ok(
    result.transactions.every((tx) => {
      const hay = `${tx.merchant ?? ""} ${tx.memo ?? ""}`.toLowerCase();
      return hay.includes("nikon") || hay.includes("adobe") || hay.includes("lightroom") || hay.includes("lens");
    }),
    "only photography-related rows",
  );

  console.log("db topic-search checks passed");
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
