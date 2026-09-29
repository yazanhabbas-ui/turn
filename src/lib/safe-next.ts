import { LOCALE_CODES } from "@/i18n/locales";

const LOCALE_PREFIX = new RegExp(`^/(${LOCALE_CODES.join("|")})(?=/|$)`);

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  // Strip a locale prefix; the router re-applies the active locale.
  return value.replace(LOCALE_PREFIX, "") || "/";
}
