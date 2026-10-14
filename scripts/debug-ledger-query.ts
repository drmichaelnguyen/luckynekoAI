import { PrismaClient } from "@prisma/client";
import {
  tryAnswerLedgerQuery,
  parseLedgerQuery,
  buildLedgerQueryWhere,
  executeLedgerQuery,
} from "../src/lib/finance/ledger-query";

async function main() {
  const prisma = new PrismaClient();
  const userId = "cmo3wiyqs0004649j4vg7uh2g";
  const msg = process.argv[2] ?? "when did i do oil change for my ram 1500";

  const categories = await prisma.category.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
    },
  });
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  const parsed = parseLedgerQuery(msg, categories, wallets);
  console.log("message:", msg);
  console.log("parsed:", JSON.stringify(parsed, null, 2));

  if (parsed) {
    const where = buildLedgerQueryWhere(userId, "CAD", parsed);
    console.log("where:", JSON.stringify(where, null, 2));
    const count = await prisma.transaction.count({ where });
    console.log("prisma count (before rank filter):", count);

    const sample = await prisma.transaction.findMany({
      where,
      take: 5,
      select: { merchant: true, memo: true, occurredAt: true, amountCents: true },
    });
    console.log("sample rows:", sample);

    const result = await executeLedgerQuery(prisma, {
      userId,
      displayCurrency: "CAD",
      query: parsed,
    });
    console.log("execute result:", result);
  }

  const answer = await tryAnswerLedgerQuery(prisma, {
    userId,
    message: msg,
    displayCurrency: "CAD",
  });
  console.log("\nfinal answer:\n", answer);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
