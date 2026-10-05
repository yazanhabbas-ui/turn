"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useApiQuery } from "@/components/admin/use-api";
import { axisStyle, baseOption, CHART_THEME, EChart } from "@/components/charts/echart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { PERIODS, type Change, type Period, type Progress } from "@/domain/profile/progress";
import { cn } from "@/lib/utils";
import { RatingSummary } from "./rating-summary";

const th = CHART_THEME.light;

/** "+12% vs last week". Good = the direction the person wants (more visitors served, shorter times). */
function ChangeNote({ change, period, lowerIsBetter = false }: { change: Change; period: Period; lowerIsBetter?: boolean }) {
  const t = useTranslations("profile.progress");
  const format = useFormatter();
  if (change.changePct === null)
    return <span className="text-muted-foreground text-xs">{t("noEarlier", { when: t(`vs.${period}`) })}</span>;
  const up = change.changePct > 0;
  const good = change.changePct === 0 ? null : up !== lowerIsBetter;
  return (
    <span
      className={cn(
        "text-xs",
        good === null
          ? "text-muted-foreground"
          : good
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-rose-700 dark:text-rose-400",
      )}
    >
      <span dir="ltr">{format.number(change.changePct / 100, { style: "percent", signDisplay: "exceptZero" })}</span>{" "}
      {t(`vs.${period}`)}
    </span>
  );
}

function Tile({
  label,
  value,
  note,
  sub,
  info,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  sub?: React.ReactNode;
  info?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {note && <div className="mt-1">{note}</div>}
      {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

/** Personal progress: tiles for the chosen period, comparison with the previous period and the branch average, trend, milestones. */
export function ProgressPanel() {
  const t = useTranslations("profile.progress");
  const format = useFormatter();
  const [period, setPeriod] = useState<Period>("week");
  const q = useApiQuery<Progress>(`/api/v1/me/progress?period=${period}`);
  const p = q.data;

  const mins = (n: number | null) =>
    n === null ? t("none") : t("minutes", { n: format.number(n, { maximumFractionDigits: 1 }) });
  const duration = (n: number | null) => {
    if (n === null) return t("none");
    const h = Math.floor(n / 60);
    return h > 0 ? t("hoursMinutes", { h, m: n % 60 }) : t("minutes", { n });
  };
  const pct = (n: number | null) =>
    n === null ? t("none") : format.number(n / 100, { style: "percent", maximumFractionDigits: 0 });
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), { month: "short", day: "numeric", timeZone: "UTC" });

  const chart = useMemo(() => {
    if (!p) return null;
    const series = p.agent
      ? p.agent.trend.map((d) => ({ date: d.date, n: d.served }))
      : (p.issued ?? p.actions).trend.map((d) => ({ date: d.date, n: d.count }));
    return {
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
        data: series.map((d) => day(d.date)),
        ...axisStyle(th),
        splitLine: { show: false },
        axisLabel: { color: th.muted, hideOverlap: true },
      },
      yAxis: { type: "value", minInterval: 1, ...axisStyle(th) },
      series: [
        {
          name: p.agent ? t("served") : p.issued ? t("issued") : t("actions"),
          type: "bar",
          data: series.map((d) => d.n),
          barMaxWidth: 18,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  const cur = p?.agent?.periods[period];
  const csat = p?.agent?.csat ?? null;
  const csatNow = csat?.periods[period];

  const csatChart = useMemo(() => {
    if (!csat) return null;
    return {
      ...baseOption(th),
      color: [th.series[0]],
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { ...baseOption(th).tooltip, trigger: "axis" },
      xAxis: {
        type: "category",
        data: csat.trend.map((d) => day(d.date)),
        ...axisStyle(th),
        splitLine: { show: false },
        axisLabel: { color: th.muted, hideOverlap: true },
      },
      yAxis: { type: "value", min: 1, max: 5, interval: 1, ...axisStyle(th) },
      series: [
        {
          name: t("csatAvg"),
          type: "line",
          connectNulls: true,
          symbolSize: 7,
          data: csat.trend.map((d) => d.avg),
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csat]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t("period")} className="bg-muted inline-flex rounded-lg p-1">
        {PERIODS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={period === k}
            onClick={() => setPeriod(k)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium",
              period === k ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {t(`periods.${k}`)}
          </button>
        ))}
      </div>

      {q.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {q.isError && <p className="text-destructive text-sm">{t("error")}</p>}

      {p && (
        <>
          {csat && csatNow && (
            <RatingSummary
              period={t(`periods.${period}`)}
              data={{
                avg: csatNow.current.avg,
                responses: csatNow.current.responses,
                satisfiedPct: csatNow.current.satisfiedPct,
                negativeCount: csatNow.current.negative,
                negativePct: csatNow.current.negativePct,
                threshold: csat.threshold,
                previousAvg: csatNow.previous.avg,
                branchAvg: csatNow.branchAvg,
              }}
            />
          )}
          {p.agent && cur && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label={t("served")}
                value={format.number(cur.current.served)}
                note={<ChangeNote change={cur.change.served} period={period} />}
                sub={
                  cur.branch?.servedPerAgent != null
                    ? t("branchServed", { n: format.number(cur.branch.servedPerAgent, { maximumFractionDigits: 1 }) })
                    : undefined
                }
              />
              <Tile
                label={t("avgService")}
                value={mins(cur.current.avgServiceMin)}
                note={<ChangeNote change={cur.change.avgServiceMin} period={period} lowerIsBetter />}
                sub={cur.branch ? t("branchAverage", { value: mins(cur.branch.avgServiceMin) }) : undefined}
              />
              <Tile
                label={t("avgWait")}
                value={mins(cur.current.avgWaitMin)}
                note={<ChangeNote change={cur.change.avgWaitMin} period={period} lowerIsBetter />}
                sub={cur.branch ? t("branchAverage", { value: mins(cur.branch.avgWaitMin) }) : undefined}
              />
              <Tile
                label={t("resolved")}
                value={pct(cur.current.resolvedPct)}
                sub={cur.branch ? t("branchAverage", { value: pct(cur.branch.resolvedPct) }) : undefined}
              />
              <Tile label={t("noShows")} value={format.number(cur.current.noShows)} />
              <Tile label={t("available")} value={duration(cur.current.availableMin)} />
              <Tile label={t("onBreak")} value={duration(cur.current.breakMin)} />
            </div>
          )}

          {p.issued && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label={t("issued")}
                value={format.number(p.issued.periods[period].current)}
                note={<ChangeNote change={p.issued.periods[period]} period={period} />}
              />
            </div>
          )}

          {csat && csatNow && (
            <section className="space-y-3" aria-label={t("csatTitle")}>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold">{t("csatTitle")}</h3>
                  <InfoTip>{t("csatHint")}</InfoTip>
                </div>
              </div>
              {csat.trend.some((d) => d.responses > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("csatTrend", { n: csat.trend.length })}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {csatChart && <EChart option={csatChart} height={200} ariaLabel={t("csatTrendAria")} />}
                  </CardContent>
                </Card>
              )}
              {csat.recent.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("csatRecent")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {csat.recent.map((c) => (
                        <li key={`${c.at}-${c.score}`} className="border-s-2 ps-3 text-sm">
                          <p>{c.comment}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {c.displayNumber ? <span dir="ltr">{c.displayNumber}</span> : null}
                            {c.displayNumber ? " · " : ""}
                            {t("csatScore", { n: c.score })} ·{" "}
                            {format.dateTime(new Date(c.at), { month: "short", day: "numeric" })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </section>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={t("actions")}
              value={format.number(p.actions.periods[period].current)}
              note={<ChangeNote change={p.actions.periods[period]} period={period} />}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {p.agent
                  ? t("trendServed", { n: p.agent.trend.length })
                  : p.issued
                    ? t("trendIssued", { n: p.issued.trend.length })
                    : t("trendActions", { n: p.actions.trend.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>{chart && <EChart option={chart} height={220} ariaLabel={t("trendAria")} />}</CardContent>
          </Card>

          {p.agent?.hosted && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label={t("hostedSessions")}
                value={format.number(p.agent.hosted[period].sessions)}
                sub={t(`periods.${period}`)}
              />
              <Tile label={t("hostedVisitors")} value={format.number(p.agent.hosted[period].visitors)} info={t("hostedHint")} />
            </div>
          )}

          {p.agent && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                label={t("totalServed")}
                value={format.number(p.agent.milestones.totalServed)}
                sub={t("activeDays", { n: p.agent.milestones.activeDays })}
              />
              <Tile
                label={t("bestDay")}
                value={p.agent.milestones.bestDay ? format.number(p.agent.milestones.bestDay.served) : t("none")}
                sub={p.agent.milestones.bestDay ? day(p.agent.milestones.bestDay.date) : undefined}
              />
              <Tile label={t("streak")} value={t("days", { n: p.agent.milestones.streakDays })} info={t("streakHint")} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
