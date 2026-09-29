"use client";

import { useLocale } from "next-intl";

/** Locale-aware list joining ("a, b and c" / "أ، ب و ج"), using the browser's Intl data. */
export function useListJoin() {
  const locale = useLocale();
  const fmt = new Intl.ListFormat(locale, { style: "narrow", type: "unit" });
  return (items: string[]) => fmt.format(items);
}
