import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALE_CODES } from "./locales";

export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: DEFAULT_LOCALE,
  // Arabic (default) lives at "/admin"; English at "/en/admin".
  localePrefix: "as-needed",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});
