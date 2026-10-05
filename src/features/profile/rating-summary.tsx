"use client";

import { Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { negativeScores } from "@/domain/feedback/negative";
import { cn } from "@/lib/utils";

export type RatingSummaryData = {
  avg: number | null;
  responses: number;
  satisfiedPct: number | null;
  negativeCount: number;
  negativePct: number | null;
  /** Scores up to this count as negative. */
  threshold: number;
  previousAvg: number | null;
  /** The whole branch's average, no colleague named. */
  branchAvg: number | null;
};

/** Five stars filled up to the rounded average. */
export function Stars({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("profile.rating");
  const format = useFormatter();
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={t("starsAria", { n: format.number(value, { maximumFractionDigits: 1 }) })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            "size-5",
            n <= Math.round(value) ? "fill-current text-amber-600 dark:text-amber-400" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The agent's average rating, prominently: the score with stars, how many visitors answered, the satisfied and negative
 * shares, the change from the previous period (neutral wording) and the branch average. Shows a friendly empty state
 * when nobody has rated yet. Used at the top of the progress summary and of "My reports".
 */
export function RatingSummary({ data, period }: { data: RatingSummaryData; period: string }) {
  const t = useTranslations("profile.rating");
  const format = useFormatter();
  const f1 = (n: number) => format.number(n, { maximumFractionDigits: 1 });
  const pct = (n: number | null) => (n === null ? t("none") : `${f1(n)}%`);

  let trend: string | null = null;
  if (data.avg !== null && data.previousAvg !== null) {
    const d = Math.round((data.avg - data.previousAvg) * 10) / 10;
    trend = d === 0 ? t("trendSame") : d > 0 ? t("trendUp", { n: f1(d) }) : t("trendDown", { n: f1(-d) });
  }

  return (
    <section aria-label={t("title")} className="bg-card rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{t("title")}</h3>
          <p className="text-muted-foreground text-xs">{period}</p>
        </div>
      </div>
      {data.responses === 0 || data.avg === null ? (
        <p className="text-muted-foreground mt-3 text-sm">{t("empty")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tabular-nums">{f1(data.avg)}</span>
              <span className="text-muted-foreground text-lg">{t("outOf")}</span>
            </div>
            <Stars value={data.avg} className="mt-1" />
            <p className="text-muted-foreground mt-1 text-xs">{t("ratings", { count: data.responses })}</p>
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">{t("satisfied")}</dt>
              <dd className="font-semibold tabular-nums">{pct(data.satisfiedPct)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                {t("negative", {
                  scores: format.list(
                    negativeScores(data.threshold).map((n) => format.number(n)),
                    { type: "unit" },
                  ),
                })}
              </dt>
              <dd className={cn("font-semibold tabular-nums", data.negativeCount > 0 && "text-rose-700 dark:text-rose-400")}>
                {t("negativeValue", { count: data.negativeCount, pct: pct(data.negativePct) })}
              </dd>
            </div>
            {data.branchAvg !== null && (
              <div>
                <dt className="text-muted-foreground text-xs">{t("branch")}</dt>
                <dd className="font-semibold tabular-nums">{t("outOfValue", { n: f1(data.branchAvg) })}</dd>
              </div>
            )}
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-muted-foreground text-xs">{t("previous")}</dt>
              <dd className="tabular-nums">
                {data.previousAvg === null ? t("previousNone") : t("outOfValue", { n: f1(data.previousAvg) })}
                {trend && <span className="text-muted-foreground"> · {trend}</span>}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
