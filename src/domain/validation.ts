import { z } from "zod";
import { DEFAULT_LOCALE, LOCALE_CODES } from "@/i18n/locales";

/**
 * Translatable text: the default locale (Arabic) is required; other enabled locales are optional.
 * Empty strings are dropped so `pickText` falls back cleanly.
 */
export const localizedText = (opts: { max?: number; required?: boolean } = {}) =>
  z
    .record(z.string(), z.string().max(opts.max ?? 200))
    .transform((v) =>
      Object.fromEntries(
        Object.entries(v)
          .map(([k, s]) => [k, s.trim()])
          .filter(([, s]) => s),
      ),
    )
    .refine((v) => Object.keys(v).every((k) => (LOCALE_CODES as string[]).includes(k)), { message: "unknown_locale" })
    .refine((v) => opts.required === false || !!v[DEFAULT_LOCALE] || !!v.en, { message: "required" });

export const uuid = z.string().uuid();
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** 1–3 letters, Latin or Arabic (A, AB, أ, ب). */
export const ticketPrefix = z
  .string()
  .trim()
  .regex(/^\p{L}{1,3}$/u);
export const weekdays = z.array(z.number().int().min(0).max(6)).max(7);

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezone = z.string().refine(isValidTimezone, { message: "invalid_timezone" });

/** Timezones offered first in pickers (the region), followed by all others. */
export const REGION_TIMEZONES = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Kuwait",
  "Asia/Muscat",
  "Asia/Baghdad",
  "Asia/Amman",
  "Asia/Beirut",
  "Asia/Damascus",
  "Asia/Jerusalem",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Tripoli",
  "Africa/Khartoum",
  "Asia/Aden",
  "Asia/Tehran",
  "Asia/Karachi",
  "Europe/Istanbul",
];
