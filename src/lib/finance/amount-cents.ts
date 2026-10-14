/** ISO 4217 currencies with no minor unit (stored 1:1 in amountCents). */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

export function isZeroDecimalCurrency(currency: string | null | undefined): boolean {
  return ZERO_DECIMAL_CURRENCIES.has((currency ?? "").trim().toUpperCase());
}

/** Convert a major-unit amount (dollars, dong, yen, …) to stored amountCents. */
export function majorToAmountCents(major: number, currency: string | null | undefined): number {
  const abs = Math.abs(major);
  if (!Number.isFinite(abs) || abs === 0) return 0;
  const minor = isZeroDecimalCurrency(currency) ? Math.round(abs) : Math.round(abs * 100);
  return minor > 0 ? minor : 0;
}

/** Convert stored amountCents back to major units for display or editing. */
export function amountCentsToMajor(cents: number, currency: string | null | undefined): number {
  if (isZeroDecimalCurrency(currency)) return cents;
  return cents / 100;
}

export function formatMoneyFromCents(
  cents: number,
  currency: string,
  opts?: { signed?: boolean },
): string {
  const upper = currency.toUpperCase();
  const major = amountCentsToMajor(Math.abs(cents), upper);
  const formatted = isZeroDecimalCurrency(upper)
    ? Math.round(major).toLocaleString("en-US")
    : major.toFixed(2);
  const sign = opts?.signed !== false && cents < 0 ? "−" : "";
  return `${sign}${upper} ${formatted}`;
}
