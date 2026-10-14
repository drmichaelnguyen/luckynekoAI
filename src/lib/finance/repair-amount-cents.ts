import type { PrismaClient } from "@prisma/client";

import { ZERO_DECIMAL_CURRENCIES } from "@/lib/finance/amount-cents";

const INT32_MAX = 2_147_483_647;

/**
 * Fix zero-decimal currency rows (VND, JPY, …) that were incorrectly stored as major×100.
 * Uses raw SQL so it runs even when Prisma cannot deserialize overflowed INT values.
 */
export async function repairMisscaledAmountCents(db: PrismaClient): Promise<void> {
  const zeroDecimalList = [...ZERO_DECIMAL_CURRENCIES].map((c) => `'${c}'`).join(", ");

  await db.$executeRawUnsafe(`
    UPDATE "Transaction"
    SET "amountCents" = "amountCents" / 100
    WHERE "amountCents" > ${INT32_MAX}
      AND upper("currency") IN (${zeroDecimalList})
      AND "amountCents" % 100 = 0
  `);

  await db.$executeRawUnsafe(`
    UPDATE "RecurrentSeries"
    SET "amountCents" = "amountCents" / 100
    WHERE "amountCents" > ${INT32_MAX}
      AND upper("currency") IN (${zeroDecimalList})
      AND "amountCents" % 100 = 0
  `);

  await db.$executeRawUnsafe(`
    UPDATE "FinancialPlan"
    SET "amountCents" = "amountCents" / 100
    WHERE "amountCents" > ${INT32_MAX}
      AND upper("currency") IN (${zeroDecimalList})
      AND "amountCents" % 100 = 0
  `);
}
