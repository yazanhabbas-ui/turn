/**
 * UI locales with a resource file in /messages. To add a language (e.g. Kurdish "ckb", Farsi "fa",
 * Urdu "ur", French "fr"): add an entry here, create messages/<code>.json with the same keys as en.json,
 * and enable it for the organization in Admin → Settings → Languages.
 */
export const LOCALES = {
  ar: { dir: "rtl", label: "العربية", speech: ["ar-SA", "ar-AE", "ar-EG", "ar"] },
  en: { dir: "ltr", label: "English", speech: ["en-US", "en-GB", "en"] },
} as const;

export type Locale = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];
export const DEFAULT_LOCALE: Locale = "ar";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value in LOCALES;
}

export function dirOf(locale: string): "rtl" | "ltr" {
  return isLocale(locale) ? LOCALES[locale].dir : "ltr";
}

/** Picks the best translation from a LocalizedText value: requested locale → default → any. */
export function pickText(value: Record<string, string> | null | undefined, locale: string, fallback = ""): string {
  if (!value) return fallback;
  return value[locale] || value[DEFAULT_LOCALE] || value.en || Object.values(value).find(Boolean) || fallback;
}
