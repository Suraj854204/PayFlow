export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "pf_locale";
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", hi: "हिन्दी" };
export const isLocale = (v: unknown): v is Locale =>
  (LOCALES as readonly string[]).includes(v as string);
