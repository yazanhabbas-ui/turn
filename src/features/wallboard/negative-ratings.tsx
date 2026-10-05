"use client";

import { Star, ThumbsDown } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { negativeScores } from "@/domain/feedback/negative";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";

type L = Record<string, string>;

export type NegativeRatings = {
  threshold: number;
  hours: number;
  total: number;
  items: {
    id: string;
    displayNumber: string;
    score: number;
    at: string;
    desk: { number: string | null; name: L | null } | null;
    agent: { name: L } | null;
    reason: L | null;
    comment: string | null;
  }[];
};

/** The theme classes the panel needs (a subset of the wallboard palette: dark, light and brand). */
type Palette = { card: string; muted: string; bad: string; badBox: string };

/**
 * "Negative ratings": the newest answers at or below the configured negative threshold, with ticket, desk, agent,
 * reason and score. No visitor name or phone. A new one flashes briefly; the list refreshes with the wallboard.
 */
export function NegativeRatingsPanel({ data, th, tick }: { data: NegativeRatings; th: Palette; tick: number }) {
  const t = useTranslations("wallboard.negative");
  const locale = useLocale();
  const format = useFormatter();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Ids not seen on the previous refresh are highlighted for a few seconds (not on the first load).
  useEffect(() => {
    const ids = new Set(data.items.map((i) => i.id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (seen.current) {
      const added = new Set([...ids].filter((id) => !seen.current!.has(id)));
      if (added.size) {
        setFresh(added);
        timer = setTimeout(() => setFresh(new Set()), 8000);
      }
    }
    seen.current = ids;
    return () => clearTimeout(timer);
  }, [data]);

  const desk = (d: NegativeRatings["items"][number]["desk"]) =>
    d ? [d.number, pickText(d.name, locale, "")].filter(Boolean).join(" · ") || "—" : "—";

  return (
    <section className={cn("rounded-xl border p-4", th.card)} aria-label={t("title")}>
      <div className="mb-3 flex items-center gap-2">
        <ThumbsDown className={cn("size-5", th.bad)} aria-hidden />
        <h2 className="text-lg font-semibold 2xl:text-2xl">{t("title")}</h2>
        {data.total > 0 && (
          <span
            className={cn("tabular ms-auto rounded-full border px-2.5 py-0.5 text-sm font-bold 2xl:text-xl", th.badBox, th.bad)}
            title={t("badgeHint", { hours: data.hours })}
          >
            {format.number(data.total)}
          </span>
        )}
      </div>
      <p className={cn("mb-3 text-xs 2xl:text-base", th.muted)}>
        {t("rule", {
          scores: format.list(
            negativeScores(data.threshold).map((n) => format.number(n)),
            { type: "unit" },
          ),
          hours: data.hours,
        })}
      </p>
      {data.items.length === 0 ? (
        <p className={th.muted}>{t("none")}</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((r) => (
            <li
              key={r.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                th.badBox,
                fresh.has(r.id) && "animate-pulse ring-2 ring-red-500",
              )}
            >
              <div className="flex items-baseline gap-3">
                <span className="tabular text-xl font-bold 2xl:text-3xl" dir="ltr">
                  {r.displayNumber}
                </span>
                <span className="text-sm font-medium 2xl:text-xl">{t("desk", { desk: desk(r.desk) })}</span>
                <span
                  className="ms-auto flex items-center gap-0.5"
                  role="img"
                  aria-label={t("score", { n: r.score })}
                  title={t("score", { n: r.score })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={cn("size-4 2xl:size-6", n <= r.score ? cn("fill-current", th.bad) : th.muted)}
                      aria-hidden
                    />
                  ))}
                </span>
              </div>
              <p className={cn("mt-1 text-xs 2xl:text-base", th.muted)}>
                {[
                  r.agent ? pickText(r.agent.name, locale, "") : "",
                  r.reason ? pickText(r.reason, locale, "") : "",
                  tick ? format.relativeTime(new Date(r.at), tick) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {r.comment && <p className="mt-1 text-sm 2xl:text-lg">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
