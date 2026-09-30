import { toWesternDigits } from "../i18n/digits";

/**
 * Canonical phone form used for hashing and sticky routing: Western digits only, a leading "+" kept,
 * an international "00" prefix converted to "+", and (when a default country code is given) a local leading 0 replaced
 * by it. Returns null when it cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode?: string): string | null {
  if (!raw) return null;
  let s = toWesternDigits(raw)
    .trim()
    .replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  // A local number with a single leading 0 (e.g. 0944 123 456) gets the country code, so it matches the +963 form.
  else if (defaultCountryCode && /^0\d/.test(s)) s = `+${defaultCountryCode}${s.slice(1)}`;
  if (!/^\+?\d{6,15}$/.test(s)) return null;
  return s;
}
