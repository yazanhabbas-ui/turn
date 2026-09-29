"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/** Locale-aware number / duration / date formatting shared by all report sections. */
export function useReportFormat() {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("reports.fmt");

  return useMemo(() => {
    const num = (n: number, digits = 0) =>
      format.number(Number.isFinite(n) ? n : 0, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

    /** Percentage given as 0..100. */
    const pct = (n: number, digits = 1) => `${num(n, digits)}%`;

    /** Minutes (float) as "m min" or "h m". */
    const minutes = (m: number) => {
      const v = Number.isFinite(m) && m > 0 ? m : 0;
      if (v < 60) return t("min", { n: num(v, v < 10 ? 1 : 0) });
      const total = Math.round(v);
      const h = Math.floor(total / 60);
      const rest = total % 60;
      return rest === 0 ? t("hour", { h: num(h) }) : t("hourMin", { h: num(h), m: num(rest) });
    };

    const weekdayName = (weekday: number, style: "short" | "long" = "short") =>
      new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + weekday)));

    const hourLabel = (hour: number) => num(hour);

    /** YYYY-MM-DD as a short, locale date (no time-zone shift). */
    const day = (iso: string) =>
      new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

    return { num, pct, minutes, weekdayName, hourLabel, day };
  }, [format, locale, t]);
}
