export const LOCALE_COOKIE = "nekozen-locale";

export const locales = ["en", "vi"] as const;
export type Locale = (typeof locales)[number];

export function parseLocale(value: string | undefined): Locale {
  const v = value?.trim().toLowerCase();
  return v === "vi" ? "vi" : "en";
}
