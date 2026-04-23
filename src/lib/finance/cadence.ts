export type RecurrentCadence = "weekly" | "monthly" | "yearly" | "irregular";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a free-form cadence string ("yearly", "every 2 weeks", "quarterly", "15th of each month")
 * into a normalized cadence plus an optional preserved custom description.
 *
 * Rules:
 * - Plain "weekly/monthly/yearly" (and common synonyms) normalize to the corresponding enum with customCadence cleared.
 * - Anything that can't be cleanly classified becomes `irregular` and we keep the original text in customCadence.
 */
export function parseCadenceInput(input: string | null | undefined): {
  cadence: RecurrentCadence;
  customCadence: string | null;
} {
  const raw = (input ?? "").trim();
  if (!raw) return { cadence: "monthly", customCadence: null };

  const lower = raw.toLowerCase();

  if (/^(weekly|every week|each week|per week|1 ?w|1 ?wk)$/.test(lower)) {
    return { cadence: "weekly", customCadence: null };
  }
  if (/^(monthly|every month|each month|per month|1 ?mo|1 ?mth)$/.test(lower)) {
    return { cadence: "monthly", customCadence: null };
  }
  if (
    /^(yearly|annually|annual|every year|each year|per year|1 ?y|1 ?yr)$/.test(lower)
  ) {
    return { cadence: "yearly", customCadence: null };
  }

  // Anything richer — "every 2 weeks", "quarterly", "every 15th", "bi-weekly" — is irregular.
  return { cadence: "irregular", customCadence: raw.slice(0, 200) };
}

/** Given an anchor date + cadence, compute a sensible first reminder date. */
export function defaultNextReminderAt(anchor: Date, cadence: RecurrentCadence): Date {
  const base = new Date(anchor.getTime());
  switch (cadence) {
    case "weekly":
      return new Date(base.getTime() + 7 * MS_PER_DAY);
    case "yearly":
      return new Date(base.getTime() + 365 * MS_PER_DAY);
    case "irregular":
    case "monthly":
    default:
      return new Date(base.getTime() + 30 * MS_PER_DAY);
  }
}

/** Describe a cadence in a short human phrase — used in UI + reminder text. */
export function describeCadence(
  cadence: RecurrentCadence,
  customCadence: string | null,
): string {
  if (customCadence && customCadence.trim()) return customCadence.trim();
  switch (cadence) {
    case "weekly":
      return "weekly";
    case "yearly":
      return "yearly";
    case "irregular":
      return "irregular";
    case "monthly":
    default:
      return "monthly";
  }
}
