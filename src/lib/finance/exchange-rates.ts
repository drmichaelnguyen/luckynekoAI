/** Fetches live FX rates from exchangerate-api.com (free tier, no key required). */

type RateCache = {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, RateCache>();

export async function getExchangeRates(
  baseCurrency: string,
): Promise<Record<string, number> | null> {
  const base = baseCurrency.toUpperCase();
  const cached = cache.get(base);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.rates;
  }
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: Record<string, number> };
    if (!json.rates) return null;
    cache.set(base, { base, rates: json.rates, fetchedAt: Date.now() });
    return json.rates;
  } catch {
    return null;
  }
}

/** Returns a short human-readable rates block for the AI context, e.g.
 *  "1 CAD = 17543.20 VND, 0.74 USD, 0.68 EUR" */
export async function buildExchangeRateContext(
  preferredCurrency: string,
): Promise<string> {
  const rates = await getExchangeRates(preferredCurrency);
  if (!rates) return "";

  // Show the most relevant currencies
  const show = ["USD", "EUR", "CAD", "VND", "GBP", "AUD", "JPY", "SGD", "THB"].filter(
    (c) => c !== preferredCurrency && rates[c] != null,
  );

  if (show.length === 0) return "";

  const parts = show.map((c) => {
    const rate = rates[c]!;
    const formatted = rate >= 100 ? rate.toFixed(0) : rate.toFixed(4);
    return `${formatted} ${c}`;
  });

  return `EXCHANGE RATES (live, base ${preferredCurrency}): 1 ${preferredCurrency} = ${parts.join(", ")}`;
}
