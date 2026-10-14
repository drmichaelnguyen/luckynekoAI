export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { prisma } = await import("@/lib/prisma");
  const { repairMisscaledAmountCents } = await import("@/lib/finance/repair-amount-cents");

  try {
    await repairMisscaledAmountCents(prisma);
  } catch (err) {
    console.error("[nekozen] Failed to repair mis-scaled amountCents rows on startup:", err);
  }
}
