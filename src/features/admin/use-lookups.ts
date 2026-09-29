"use client";

import { useLocale } from "next-intl";
import { useApiQuery } from "@/components/admin/use-api";
import { pickText } from "@/i18n/locales";
import type { L, Lookups } from "./types";

export const LOOKUPS = "/api/v1/admin/lookups";

export function useLookups() {
  return useApiQuery<Lookups>(LOOKUPS);
}

/** Localized text picker bound to the current UI locale. */
export function useText() {
  const locale = useLocale();
  return (v: L | null | undefined, fallback = "") => pickText(v, locale, fallback);
}
