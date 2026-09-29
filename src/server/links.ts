import { DEFAULT_LOCALE } from "@/i18n/locales";
import { env } from "./env";

/** Absolute link to a page in the given UI locale (the default locale has no prefix). */
export function appLink(path: string, locale: string = DEFAULT_LOCALE): string {
  const base = env().APP_URL.replace(/\/$/, "");
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${base}${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}
