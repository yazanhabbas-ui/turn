import { toWesternDigits } from "../i18n/digits";

/**
 * Canonical phone form used for hashing and sticky routing: Western digits only, a leading "+" kept,
 * an international "00" prefix converted to "+". Returns null when it cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = toWesternDigits(raw)
    .trim()
    .replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!/^\+?\d{6,15}$/.test(s)) return null;
  return s;
}
