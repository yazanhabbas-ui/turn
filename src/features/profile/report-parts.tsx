"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { axisStyle, baseOption, CHART_THEME, EChart } from "@/components/charts/echart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import type { AgentReport, DailyRow, ReportStats } from "@/domain/profile/agent-report";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const th = CHART_THEME.light;

/** Number formatting shared by the report cards. */
export function useReportFormat() {
  const t = useTranslations("profile.reports");
  const format = useFormatter();
  return {
    mins: (n: number | null) => (n === null ? t("none") : t("minutes", { n: format.number(n, { maximumFractionDigits: 1 }) })),
    pct: (n: number | null) => (n === null ? t("none") : format.number(n / 100, { style: "percent", maximumFractionDigits: 0 })),
    score: (n: number | null) => (n === null ? t("none") : format.number(n, { maximumFractionDigits: 1 })),
    int: (n: number) => format.number(n),
    day: (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }),
  };
}

type SortKey = keyof Omit<DailyRow, "responses">;
const COLUMNS: SortKey[] = ["date", "served", "noShows", "avgServiceMin", "avgWaitMin", "resolvedPct", "avgScore"];
const HEAD: Record<SortKey, string> = {
  date: "daily.date",
  served: "summary.served",
  noShows: "summary.noShows",
  avgServiceMin: "summary.avgService",
  avgWaitMin: "summary.avgWait",
  resolvedPct: "summary.resolved",
  avgScore: "summary.avgScore",
};

/** Daily summary: one sortable row per day with activity, and a totals row. */
export function DailyTable({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const f = useReportFormat();
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const showScore = report.csat !== null;
  const cols = COLUMNS.filter((c) => c !== "avgScore" || showScore);

  const rows = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...report.daily].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === y) return 0;
      if (x === null) return 1; // empty values always last
      if (y === null) return -1;
      return (x < y ? -1 : 1) * sign;
    });
  }, [report.daily, sort]);

  const cell = (key: SortKey, r: ReportStats & { date?: string }) => {
    switch (key) {
      case "date":
        return r.date ? f.day(r.date) : t("daily.total");
      case "served":
        return f.int(r.served);
      case "noShows":
        return f.int(r.noShows);
      case "avgServiceMin":
        return f.mins(r.avgServiceMin);
      case "avgWaitMin":
        return f.mins(r.avgWaitMin);
      case "resolvedPct":
        return f.pct(r.resolvedPct);
      case "avgScore":
        return f.score(r.avgScore);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("daily.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("daily.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-start">
                  {cols.map((c) => {
                    const active = sort.key === c;
                    return (
                      <th
                        key={c}
                        scope="col"
                        className="px-2 py-2 text-start font-medium"
                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <button
                          type="button"
                          className={cn("hover:text-foreground text-start", active && "text-foreground")}
                          onClick={() => setSort({ key: c, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
                          aria-label={t("daily.sortBy", { column: t(HEAD[c]) })}
                        >
                          {t(HEAD[c])}
                          {active && <span aria-hidden> {sort.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-b last:border-0">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-2 tabular-nums">
                        {cell(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold">
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-2 tabular-nums">
                      {cell(c, report.totals)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** By visit reason: count with a bar, and the average service time. */
export function ReasonTable({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const locale = useLocale();
  const f = useReportFormat();
  const max = Math.max(1, ...report.byReason.map((r) => r.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("byReason.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {report.byReason.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("byReason.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("byReason.reason")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("byReason.count")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("byReason.avgService")}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.byReason.map((r) => (
                <tr key={r.reasonId} className="border-b last:border-0">
                  <td className="px-2 py-2">{pickText(r.name, locale, "—")}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="bg-muted h-2 w-24 overflow-hidden rounded-full" aria-hidden>
                        <div className="bg-brand h-full rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
                      </div>
                      <span className="tabular-nums">{f.int(r.count)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{f.mins(r.avgServiceMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function useBarOption(labels: string[], values: number[], name: string) {
  return useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0]],
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        ...baseOption(th).tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(128,128,128,0.08)" } },
      },
      xAxis: {
        type: "category",
        data: labels,
        ...axisStyle(th),
        splitLine: { show: false },
        axisLabel: { color: th.muted, hideOverlap: true },
      },
      yAxis: { type: "value", minInterval: 1, ...axisStyle(th) },
      series: [{ name, type: "bar", data: values, barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels.join("|"), values.join("|"), name],
  );
}

/** Busiest hours of the day. */
export function HourChart({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const format = useFormatter();
  const labels = report.byHour.map((_, h) => format.number(h, { minimumIntegerDigits: 2 }));
  const option = useBarOption(labels, report.byHour, t("byHour.series"));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t("byHour.title")}</CardTitle>
          <InfoTip>{t("byHour.hint")}</InfoTip>
        </div>
      </CardHeader>
      <CardContent>
        <EChart option={option} height={220} ariaLabel={t("byHour.aria")} />
      </CardContent>
    </Card>
  );
}

/** Service-time distribution in buckets. */
export function DistributionChart({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const labels = report.distribution.map((b) =>
    b.toMin === null ? t("distribution.open", { from: b.fromMin }) : t("distribution.range", { from: b.fromMin, to: b.toMin }),
  );
  const option = useBarOption(
    labels,
    report.distribution.map((b) => b.count),
    t("distribution.series"),
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t("distribution.title")}</CardTitle>
          <InfoTip>{t("distribution.hint")}</InfoTip>
        </div>
      </CardHeader>
      <CardContent>
        <EChart option={option} height={220} ariaLabel={t("distribution.aria")} />
      </CardContent>
    </Card>
  );
}

/** This period against the agent's previous period and the branch average (a total, never a list of colleagues). */
export function ComparisonTable({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const format = useFormatter();
  const f = useReportFormat();
  const { comparison: c, totals: s } = report;
  const rows: { label: string; cur: string; prev: string; branch: string; pct?: number | null }[] = [
    {
      label: t("summary.served"),
      cur: f.int(s.served),
      prev: f.int(c.previous.served),
      branch: c.branch ? f.int(c.branch.served) : t("none"),
      pct: c.change.served.changePct,
    },
    {
      label: t("summary.avgService"),
      cur: f.mins(s.avgServiceMin),
      prev: f.mins(c.previous.avgServiceMin),
      branch: f.mins(c.branch?.avgServiceMin ?? null),
      pct: c.change.avgServiceMin.changePct,
    },
    {
      label: t("summary.avgWait"),
      cur: f.mins(s.avgWaitMin),
      prev: f.mins(c.previous.avgWaitMin),
      branch: f.mins(c.branch?.avgWaitMin ?? null),
      pct: c.change.avgWaitMin.changePct,
    },
    {
      label: t("summary.resolved"),
      cur: f.pct(s.resolvedPct),
      prev: f.pct(c.previous.resolvedPct),
      branch: f.pct(c.branch?.resolvedPct ?? null),
    },
    ...(report.csat
      ? [
          {
            label: t("summary.avgScore"),
            cur: f.score(s.avgScore),
            prev: f.score(c.previous.avgScore),
            branch: f.score(c.branch?.avgScore ?? null),
          },
        ]
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t("comparison.title")}</CardTitle>
          <InfoTip>{t("comparison.hint")}</InfoTip>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("comparison.metric")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("comparison.thisPeriod")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("comparison.previousPeriod")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("comparison.branch")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b last:border-0">
                <td className="px-2 py-2">{r.label}</td>
                <td className="px-2 py-2 font-semibold tabular-nums">{r.cur}</td>
                <td className="px-2 py-2 tabular-nums">
                  {r.prev}
                  {r.pct != null && (
                    <span className="text-muted-foreground ms-2 text-xs" dir="ltr">
                      {format.number(r.pct / 100, { style: "percent", signDisplay: "exceptZero" })}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">{r.branch}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Satisfaction summary of the period: average, distribution and the latest written comments. */
export function SatisfactionBlock({ report }: { report: AgentReport }) {
  const t = useTranslations("profile.reports");
  const format = useFormatter();
  const f = useReportFormat();
  const csat = report.csat;
  const max = Math.max(1, ...(csat?.distribution.map((d) => d.count) ?? [1]));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t("csat.title")}</CardTitle>
          <InfoTip>{t("csat.hint")}</InfoTip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!csat ? (
          <p className="text-muted-foreground text-sm">{t("csat.off")}</p>
        ) : csat.responses === 0 ? (
          <p className="text-muted-foreground text-sm">{t("csat.none")}</p>
        ) : (
          <>
            <div>
              <h4 className="text-muted-foreground mb-2 text-xs font-medium">{t("csat.distribution")}</h4>
              <ul className="space-y-1">
                {[...csat.distribution].reverse().map((d) => (
                  <li key={d.score} className="flex items-center gap-2 text-sm">
                    <span className="w-4 tabular-nums">{format.number(d.score)}</span>
                    <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full" aria-hidden>
                      <div className="bg-brand h-full rounded-full" style={{ width: `${(d.count / max) * 100}%` }} />
                    </div>
                    <span className="w-8 text-end tabular-nums">{f.int(d.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {csat.comments.length > 0 && (
              <div>
                <h4 className="text-muted-foreground mb-2 text-xs font-medium">{t("csat.comments")}</h4>
                <ul className="space-y-3">
                  {csat.comments.map((c) => (
                    <li key={`${c.displayNumber}-${c.at}`} className="border-s-2 ps-3 text-sm">
                      <p>{c.comment}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {t("csat.commentMeta", {
                          number: c.displayNumber,
                          score: c.score,
                          date: format.dateTime(new Date(c.at), { dateStyle: "medium", timeZone: report.range.timezone }),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
