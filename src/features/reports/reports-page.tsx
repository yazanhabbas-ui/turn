"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/admin/form";
import { api } from "@/components/admin/use-api";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExportSectionId } from "@/domain/reports/sections";
import type { Forecast, ReportData } from "@/domain/reports/types";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ExportMenu, SectionDownload } from "./export-menu";
import {
  daysBetween,
  defaultRange,
  MAX_DAYS,
  parseFilters,
  toQuery,
  type OverviewResponse,
  type ReportMeta,
  type ReportFilterState,
} from "./filters";
import {
  AgentServedChart,
  BacklogChart,
  BranchChart,
  CsatDistributionChart,
  CsatTrendChart,
  DailyChart,
  ForecastDaysChart,
  ForecastHoursChart,
  HourChart,
  PeakHeatmap,
  QueueLengthChart,
  RepeatDistributionChart,
  ReasonMixChart,
  ReasonWeeklyChart,
  ThroughputChart,
  WeekdayChart,
} from "./report-charts";
import { ReportFilters } from "./report-filters";
import { AgentsTable, CsatGroupTable, LowCommentsTable, ReasonsTable, RepeatVisitorsTable, ShiftsTable } from "./report-tables";
import { SchedulesPanel } from "./schedules-panel";
import { useReportFormat } from "./use-report-format";

/** The current filter query when the viewer may export (enables the per-section download buttons), else null. */
const ExportQuery = createContext<string | null>(null);

/** Sections whose table would have no rows in this report. */
function emptySections(d: ReportData | undefined): ExportSectionId[] {
  if (!d) return [];
  const out: ExportSectionId[] = [];
  if (d.summary.visitors === 0) out.push("summary");
  if (!d.byDay.length) out.push("byDay");
  if (!d.byHour.some((h) => h.visitors > 0)) out.push("byHour");
  if (!d.byReason.length) out.push("byReason");
  if (!d.agents.length) out.push("byAgent");
  if (d.byBranch.length <= 1) out.push("byBranch");
  if (!d.byShift.length) out.push("byShift");
  if (!d.repeat.uniqueVisitors) out.push("repeatSummary", "repeatDistribution");
  if (!d.repeat.top.length) out.push("repeatTop");
  if (!d.csat.summary.responses) out.push("csatSummary", "csatDistribution", "csatByDay", "csatBreakdown");
  if (!d.csat.lowComments.length) out.push("csatComments");
  if (!d.heatmap.cells.length) out.push("heatmap");
  return out;
}

export function ReportsPage({ canExport, canSchedule }: { canExport: boolean; canSchedule: boolean }) {
  const t = useTranslations("reports");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const parsed = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);

  // Default dates are "today" in the branch's time zone. Until the first response tells us which one, use the browser's.
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    setTz((cur) => cur ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
    document.body.classList.add("reports-print");
    return () => document.body.classList.remove("reports-print");
  }, []);

  const filters: ReportFilterState = useMemo(() => {
    const def = defaultRange(tz ?? "UTC");
    let from = parsed.from || def.from;
    let to = parsed.to || def.to;
    if (to < from || daysBetween(from, to) + 1 > MAX_DAYS) ({ from, to } = def);
    return { ...parsed, from, to };
  }, [parsed, tz]);
  const query = toQuery(filters);

  const report = useQuery({
    queryKey: ["reports", "overview", query],
    queryFn: () => api<OverviewResponse>(`/api/v1/reports/overview?${query}`),
    placeholderData: keepPreviousData,
    enabled: tz !== null,
  });
  const forecastPath = `/api/v1/reports/forecast${filters.branchId ? `?branchId=${encodeURIComponent(filters.branchId)}` : ""}`;
  const forecast = useQuery({
    queryKey: ["reports", "forecast", filters.branchId],
    queryFn: () => api<Forecast>(forecastPath),
    placeholderData: keepPreviousData,
  });

  const reportTz = report.data?.timezone;
  useEffect(() => {
    if (reportTz && !parsed.from && !parsed.to) setTz(reportTz);
  }, [reportTz, parsed.from, parsed.to]);

  const onChange = useCallback(
    (patch: Partial<ReportFilterState>) => {
      router.replace(`${pathname}?${toQuery({ ...filters, ...patch })}`, { scroll: false });
    },
    [router, pathname, filters],
  );

  const data = report.data?.data;
  const meta = report.data?.meta;
  const stale = report.isPlaceholderData;

  return (
    <ExportQuery.Provider value={canExport ? query : null}>
      <div className="report-root mx-auto max-w-7xl">
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={
            canExport ? (
              <div className="no-print">
                <ExportMenu query={query} emptySections={emptySections(report.data?.data)} />
              </div>
            ) : null
          }
        />
        <div className="print-only mb-4 text-sm">
          {t("printRange", { from: filters.from, to: filters.to })}
          {report.data &&
            ` · ${t("generatedAt", { at: format.dateTime(new Date(report.data.generatedAt), { dateStyle: "medium", timeStyle: "short", timeZone: report.data.timezone }) })}`}
        </div>

        <ReportFilters filters={filters} meta={meta} timeZone={tz ?? "UTC"} onChange={onChange} />

        <div className={cn("space-y-6 transition-opacity", stale && "opacity-60")} aria-busy={report.isFetching}>
          {report.isError && !data ? (
            <ErrorState onRetry={() => report.refetch()} />
          ) : !data ? (
            <ReportSkeleton />
          ) : data.summary.visitors === 0 ? (
            <EmptyState title={t("empty")} />
          ) : (
            <ReportBody
              data={data}
              reasons={meta?.reasons ?? []}
              timeZone={report.data?.timezone ?? tz ?? "UTC"}
              multiBranch={(meta?.branches.length ?? 0) > 1 && !filters.branchId}
            />
          )}

          <ForecastCard query={forecast} />

          {canSchedule && (
            <details className="no-print bg-card group ring-foreground/10 rounded-xl ring-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold">
                {t("schedules.title")}
                <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t p-4">
                <SchedulesPanel />
              </div>
            </details>
          )}
        </div>
      </div>
    </ExportQuery.Provider>
  );
}

/* ─────────────── Loading ─────────────── */

function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-72 rounded-xl" />
      ))}
    </div>
  );
}

/* ─────────────── Sections ─────────────── */

function Section({
  title,
  description,
  children,
  className,
  exports,
  empty,
}: {
  title: string;
  description?: string;
  /** Export sections this card downloads; shows the download button for viewers who may export. */
  exports?: ExportSectionId[];
  /** The card has no data (still downloadable, marked). */
  empty?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const query = useContext(ExportQuery);
  return (
    <Card className={cn("report-card", className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {query !== null && exports && (
          <CardAction>
            <SectionDownload query={query} sections={exports} label={title} empty={empty} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Tile({
  label,
  value,
  sub,
  hint,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="report-card bg-card ring-foreground/10 flex flex-col gap-1 rounded-xl p-4 ring-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="tabular text-2xl leading-tight font-bold">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      {badge}
      {hint && <p className="text-muted-foreground mt-1 text-[11px] leading-snug">{hint}</p>}
    </div>
  );
}

function ReportBody({
  data,
  reasons,
  timeZone,
  multiBranch,
}: {
  data: ReportData;
  reasons: ReportMeta["reasons"];
  timeZone: string;
  multiBranch: boolean;
}) {
  const t = useTranslations("reports");
  const f = useReportFormat();
  const s = data.summary;
  const met = s.serviceLevel.pct >= s.serviceLevel.targetPct;
  const query = useContext(ExportQuery);

  return (
    <>
      {query !== null && (
        <div className="no-print flex justify-end">
          <SectionDownload query={query} sections={["summary"]} label={t("kpi.title")} />
        </div>
      )}
      <section aria-label={t("kpi.title")} className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Tile label={t("kpi.visitors")} value={f.num(s.visitors)} />
        <Tile
          label={t("kpi.served")}
          value={f.num(s.served)}
          sub={t("kpi.servedSub", { noShow: f.num(s.noShow), cancelled: f.num(s.cancelled) })}
        />
        <Tile label={t("kpi.avgWait")} value={f.minutes(s.wait.avg)} />
        <Tile label={t("kpi.medianWait")} value={f.minutes(s.wait.median)} />
        <Tile label={t("kpi.p90Wait")} value={f.minutes(s.wait.p90)} />
        <Tile label={t("kpi.maxWait")} value={f.minutes(s.wait.max)} />
        <Tile label={t("kpi.avgService")} value={f.minutes(s.service.avg)} />
        <Tile label={t("kpi.p90Service")} value={f.minutes(s.service.p90)} />
        <Tile label={t("kpi.sla")} value={f.pct(s.slaPct)} hint={t("kpi.slaHint")} />
        <Tile
          label={t("kpi.serviceLevel")}
          value={f.pct(s.serviceLevel.pct)}
          sub={t("kpi.serviceLevelSub", { target: f.num(s.serviceLevel.targetPct), minutes: f.num(s.serviceLevel.minutes) })}
          badge={
            <span
              className={cn(
                "mt-1 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                met
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
              )}
            >
              {met ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
              {met ? t("kpi.targetMet") : t("kpi.targetMissed")}
            </span>
          }
        />
        <Tile
          label={t("kpi.abandonment")}
          value={f.pct(s.abandonmentPct)}
          sub={t("kpi.abandonmentSub", { wait: f.minutes(s.avgWaitBeforeAbandonMin) })}
        />
        <Tile label={t("kpi.recall")} value={f.pct(s.recallRatePct)} />
        <Tile label={t("kpi.transfer")} value={f.pct(s.transferRatePct)} />
        <Tile
          label={t("kpi.returning")}
          value={f.pct(s.returningPct)}
          sub={t("kpi.returningSub", { first: f.pct(s.firstVisitPct), returning: f.pct(s.returningPct) })}
        />
        <Tile label={t("kpi.fairness")} value={f.num(s.fairnessIndex, 2)} hint={t("kpi.fairnessHint")} />
        <Tile label={t("kpi.stillOpen")} value={f.num(s.stillOpen)} />
        {data.csat.summary.responses > 0 && (
          <>
            <Tile
              label={t("kpi.csat")}
              value={data.csat.summary.avg === null ? "—" : t("csat.outOf", { n: f.num(data.csat.summary.avg, 1) })}
              sub={t("kpi.csatSub", { n: f.num(data.csat.summary.responses) })}
            />
            <Tile
              label={t("kpi.csatSatisfied")}
              value={f.pct(data.csat.summary.satisfiedPct)}
              hint={t("kpi.csatSatisfiedHint")}
            />
            <Tile label={t("kpi.csatRate")} value={f.pct(data.csat.summary.responseRatePct)} />
            {data.csat.summary.nps && (
              <Tile label={t("kpi.nps")} value={f.num(data.csat.summary.nps.score)} hint={t("kpi.npsHint")} />
            )}
          </>
        )}
      </section>

      <Section title={t("sections.volume")} exports={["byDay", "byHour", "byBranch"]}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartBlock title={t("charts.perDay")} className="lg:col-span-2">
            <DailyChart data={data.byDay} />
          </ChartBlock>
          <ChartBlock title={t("charts.perHour")}>
            <HourChart data={data.byHour} />
          </ChartBlock>
          <ChartBlock title={t("charts.perWeekday")}>
            <WeekdayChart data={data.byWeekday} />
          </ChartBlock>
          {multiBranch && data.byBranch.length > 1 && (
            <ChartBlock title={t("charts.perBranch")}>
              <BranchChart data={data.byBranch} />
            </ChartBlock>
          )}
          <ChartBlock title={t("charts.reasonMix")}>
            <ReasonMixChart data={data.byReason} />
          </ChartBlock>
          <ChartBlock title={t("charts.reasonWeekly")} className="lg:col-span-2">
            <ReasonWeeklyChart data={data.reasonMixWeekly} reasons={data.byReason} />
          </ChartBlock>
        </div>
      </Section>

      {data.byShift.length > 0 && (
        <Section title={t("sections.shifts")} description={t("shifts.hint")} exports={["byShift"]}>
          <ShiftsTable shifts={data.byShift} />
        </Section>
      )}

      <Section title={t("sections.peak")} description={t("charts.peakHint")} exports={["heatmap"]}>
        <PeakHeatmap data={data.heatmap} />
      </Section>

      <Section title={t("sections.queue")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartBlock title={t("charts.queueLength")} className="lg:col-span-2">
            <QueueLengthChart data={data.queueLengthByHour} />
          </ChartBlock>
          <ChartBlock title={t("charts.throughput")}>
            <ThroughputChart data={data.byHour} />
          </ChartBlock>
          <ChartBlock title={t("charts.backlog")}>
            <BacklogChart data={data.backlogByDay} />
          </ChartBlock>
        </div>
      </Section>

      <Section title={t("sections.agents")} exports={["byAgent"]} empty={data.agents.length === 0}>
        {data.agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("agents.empty")}</p>
        ) : (
          <div className="space-y-6">
            <AgentsTable agents={data.agents} shifts={data.byShift} />
            <ChartBlock title={t("charts.servedPerAgent")} description={t("charts.servedPerAgentHint")}>
              <AgentServedChart data={data.agents} />
            </ChartBlock>
          </div>
        )}
      </Section>

      <Section title={t("sections.reasons")} exports={["byReason"]} empty={data.byReason.length === 0}>
        <ReasonsTable reasons={data.byReason} />
      </Section>

      <CsatSection data={data.csat} agents={data.agents} reasons={reasons} timeZone={timeZone} />

      <RepeatSection data={data.repeat} reasons={reasons} timeZone={timeZone} />
    </>
  );
}

function CsatSection({
  data,
  agents,
  reasons,
  timeZone,
}: {
  data: ReportData["csat"];
  agents: ReportData["agents"];
  reasons: ReportMeta["reasons"];
  timeZone: string;
}) {
  const t = useTranslations("reports.csat");
  const f = useReportFormat();
  const sm = data.summary;
  return (
    <Section
      title={t("title")}
      description={t("hint")}
      exports={["csatSummary", "csatDistribution", "csatByDay", "csatBreakdown", "csatComments"]}
      empty={sm.responses === 0}
    >
      {sm.responses === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Tile label={t("kpi.avg")} value={sm.avg === null ? "—" : t("outOf", { n: f.num(sm.avg, 1) })} />
            <Tile label={t("kpi.satisfied")} value={f.pct(sm.satisfiedPct)} hint={t("kpi.satisfiedHint")} />
            <Tile label={t("kpi.responses")} value={f.num(sm.responses)} sub={t("kpi.ofVisits", { n: f.num(sm.eligible) })} />
            <Tile label={t("kpi.rate")} value={f.pct(sm.responseRatePct)} />
            {sm.nps && (
              <Tile
                label={t("kpi.nps")}
                value={f.num(sm.nps.score)}
                sub={t("kpi.npsSub", { n: f.num(sm.nps.responses) })}
                hint={t("kpi.npsHint")}
              />
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartBlock title={t("distribution")}>
              <CsatDistributionChart data={sm.distribution} />
            </ChartBlock>
            <ChartBlock title={t("trend")}>
              <CsatTrendChart data={data.byDay} />
            </ChartBlock>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {data.byAgent.length > 0 && (
              <ChartBlock title={t("byAgent")}>
                <CsatGroupTable groups={data.byAgent} outsideLabel="—" />
              </ChartBlock>
            )}
            {data.byReason.length > 0 && (
              <ChartBlock title={t("byReason")}>
                <CsatGroupTable groups={data.byReason} outsideLabel="—" />
              </ChartBlock>
            )}
            {data.byBranch.length > 1 && (
              <ChartBlock title={t("byBranch")}>
                <CsatGroupTable groups={data.byBranch} outsideLabel="—" />
              </ChartBlock>
            )}
            {data.byShift.length > 0 && (
              <ChartBlock title={t("byShift")}>
                <CsatGroupTable groups={data.byShift} outsideLabel={t("outsideShifts")} />
              </ChartBlock>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("lowComments")}</h3>
            <p className="text-muted-foreground mb-1 text-xs">{t("lowCommentsHint")}</p>
            {data.lowComments.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">{t("noLowComments")}</p>
            ) : (
              <div className="mt-2">
                <LowCommentsTable comments={data.lowComments} agents={agents} reasons={reasons} timeZone={timeZone} />
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function RepeatSection({
  data,
  reasons,
  timeZone,
}: {
  data: ReportData["repeat"];
  reasons: ReportMeta["reasons"];
  timeZone: string;
}) {
  const t = useTranslations("reports.repeat");
  const f = useReportFormat();
  return (
    <Section
      title={t("title")}
      description={t("hint")}
      exports={["repeatSummary", "repeatDistribution", "repeatTop"]}
      empty={data.uniqueVisitors === 0}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile label={t("kpi.unique")} value={f.num(data.uniqueVisitors)} />
          <Tile label={t("kpi.repeat")} value={f.num(data.repeatVisitors)} />
          <Tile label={t("kpi.rate")} value={f.pct(data.repeatRatePct)} />
          <Tile label={t("kpi.avgVisits")} value={f.num(data.avgVisits, 2)} />
          <Tile label={t("kpi.anonymous")} value={f.num(data.anonymousTickets)} hint={t("kpi.anonymousHint")} />
        </div>
        {data.uniqueVisitors > 0 && (
          <ChartBlock title={t("distribution")}>
            <RepeatDistributionChart data={data.distribution} />
          </ChartBlock>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("returning")}</h3>
          {data.top.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">{t("empty")}</p>
          ) : (
            <div className="mt-2 space-y-2">
              <RepeatVisitorsTable visitors={data.top} reasons={reasons} timeZone={timeZone} />
              {data.top.length >= 100 && <p className="text-muted-foreground text-xs">{t("truncated", { n: f.num(100) })}</p>}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function ChartBlock({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="text-muted-foreground mb-1 text-xs">{description}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/* ─────────────── Forecast ─────────────── */

function ForecastCard({ query }: { query: { data?: Forecast; isError: boolean; isLoading: boolean; refetch: () => unknown } }) {
  const t = useTranslations("reports");
  const f = useReportFormat();
  const fc = query.data;
  return (
    <Section
      title={t("sections.forecast")}
      description={
        fc
          ? t("forecast.assumptions", {
              days: f.num(fc.basedOnDays),
              service: f.minutes(fc.avgServiceMin),
              target: f.num(fc.targetUtilisationPct),
            })
          : undefined
      }
    >
      {query.isError && !fc ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : !fc ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : fc.basedOnDays === 0 ? (
        <p className="text-muted-foreground text-sm">{t("forecast.noHistory")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartBlock title={t("forecast.nextDays")}>
            <ForecastDaysChart data={fc.days} />
          </ChartBlock>
          <ChartBlock title={t("forecast.tomorrow")} description={t("forecast.tomorrowHint")}>
            <ForecastHoursChart data={fc.tomorrow.hours} />
          </ChartBlock>
        </div>
      )}
    </Section>
  );
}
