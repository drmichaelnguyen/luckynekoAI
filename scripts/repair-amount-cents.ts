import { PrismaClient } from "@prisma/client";

import { repairMisscaledAmountCents } from "../src/lib/finance/repair-amount-cents";

const prisma = new PrismaClient();

async function main() {
  await repairMisscaledAmountCents(prisma);
  console.log("Repaired mis-scaled amountCents rows (zero-decimal currencies stored as major×100).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
