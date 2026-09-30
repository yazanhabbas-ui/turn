"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { axisStyle, baseOption, CHART_THEME, EChart } from "@/components/charts/echart";
import type { Forecast, ReportData } from "@/domain/reports/types";
import { pickText } from "@/i18n/locales";
import { useReportFormat } from "./use-report-format";

const th = CHART_THEME.light;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type TipParam = {
  axisValueLabel?: string;
  name?: string;
  marker?: string;
  seriesName?: string;
  value: unknown;
  seriesIndex: number;
};

/** Axis tooltip with localized numbers. `fmt` formats one value of series `i`. */
function axisTooltip(fmt: (seriesIndex: number, v: number) => string) {
  return {
    ...baseOption(th).tooltip,
    trigger: "axis" as const,
    axisPointer: { type: "shadow" as const, shadowStyle: { color: "rgba(128,128,128,0.08)" } },
    formatter: (ps: TipParam | TipParam[]) => {
      const list = Array.isArray(ps) ? ps : [ps];
      if (!list.length) return "";
      const rows = list
        .map((p) => `${p.marker ?? ""} ${p.seriesName ?? ""}: <b>${fmt(p.seriesIndex, Number(p.value))}</b>`)
        .join("<br/>");
      return `${list[0].axisValueLabel ?? list[0].name ?? ""}<br/>${rows}`;
    },
  };
}

const grid = { left: 8, right: 16, top: 52, bottom: 8, containLabel: true };

function valueAxis(name: string, extra: Record<string, unknown> = {}) {
  return {
    type: "value" as const,
    name,
    nameLocation: "end" as const,
    nameTextStyle: { color: th.muted, align: "left" as const },
    minInterval: 1,
    ...axisStyle(th),
    ...extra,
  };
}

function categoryAxis(data: string[], name?: string, extra: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    data,
    name,
    nameLocation: "middle" as const,
    nameGap: 28,
    nameTextStyle: { color: th.muted },
    ...axisStyle(th),
    splitLine: { show: false },
    ...extra,
  };
}

const noLegend = { show: false };

/* ─────────────── Volume ─────────────── */

export function DailyChart({ data }: { data: ReportData["byDay"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0], th.series[1]],
      grid,
      tooltip: axisTooltip((i, v) => (i === 0 ? f.num(v) : f.minutes(v))),
      xAxis: categoryAxis(
        data.map((d) => f.day(d.date)),
        undefined,
        { axisLabel: { color: th.muted, hideOverlap: true } },
      ),
      yAxis: [
        valueAxis(t("visitors")),
        valueAxis(t("avgWaitMin"), {
          minInterval: 0,
          splitLine: { show: false },
          axisLabel: { color: th.muted, formatter: (v: number) => f.num(v) },
        }),
      ],
      series: [
        {
          name: t("visitors"),
          type: "bar",
          data: data.map((d) => d.visitors),
          barMaxWidth: 36,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
        {
          name: t("avgWaitMin"),
          type: "line",
          yAxisIndex: 1,
          data: data.map((d) => Number(d.avgWaitMin.toFixed(1))),
          symbolSize: 6,
          lineStyle: { width: 2 },
        },
      ],
    }),
    [data, f, t],
  );
  return <EChart option={option} height={300} ariaLabel={t("perDay")} />;
}

export function HourChart({ data }: { data: ReportData["byHour"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.hour, d]));
    return {
      ...baseOption(th),
      color: [th.series[0]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(HOURS.map(f.hourLabel), t("hourOfDay")),
      yAxis: valueAxis(t("visitors")),
      series: [
        {
          name: t("visitors"),
          type: "bar",
          data: HOURS.map((h) => by.get(h)?.visitors ?? 0),
          barMaxWidth: 24,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={260} ariaLabel={t("perHour")} />;
}

export function WeekdayChart({ data }: { data: ReportData["byWeekday"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.weekday, d.visitors]));
    return {
      ...baseOption(th),
      color: [th.series[0]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(WEEKDAYS.map((d) => f.weekdayName(d))),
      yAxis: valueAxis(t("visitors")),
      series: [
        {
          name: t("visitors"),
          type: "bar",
          data: WEEKDAYS.map((d) => by.get(d) ?? 0),
          barMaxWidth: 36,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={260} ariaLabel={t("perWeekday")} />;
}

export function BranchChart({ data }: { data: ReportData["byBranch"] }) {
  const t = useTranslations("reports.charts");
  const locale = useLocale();
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0], th.series[2]],
      grid,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(data.map((b) => pickText(b.name, locale))),
      yAxis: valueAxis(t("visitors")),
      series: [
        { name: t("visitors"), type: "bar", data: data.map((b) => b.visitors), barMaxWidth: 36 },
        { name: t("served"), type: "bar", data: data.map((b) => b.served), barMaxWidth: 36 },
      ],
    }),
    [data, f, locale, t],
  );
  return <EChart option={option} height={260} ariaLabel={t("perBranch")} />;
}

export function ReasonMixChart({ data }: { data: ReportData["byReason"] }) {
  const t = useTranslations("reports.charts");
  const locale = useLocale();
  const f = useReportFormat();
  const rows = useMemo(() => [...data].filter((r) => r.visitors > 0).sort((a, b) => b.visitors - a.visitors), [data]);
  const option = useMemo(
    () => ({
      ...baseOption(th),
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      legend: noLegend,
      tooltip: { ...axisTooltip((_, v) => f.num(v)), axisPointer: { type: "none" } },
      xAxis: valueAxis("", { show: false, splitLine: { show: false } }),
      yAxis: categoryAxis(
        rows.map((r) => pickText(r.name, locale)),
        undefined,
        { inverse: true },
      ),
      series: [
        {
          name: t("visitors"),
          type: "bar",
          barMaxWidth: 22,
          data: rows.map((r) => ({ value: r.visitors, itemStyle: { color: r.color, borderRadius: [0, 3, 3, 0] } })),
          label: { show: true, position: "right", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    }),
    [rows, f, locale, t],
  );
  return <EChart option={option} height={Math.max(180, rows.length * 34 + 24)} ariaLabel={t("reasonMix")} />;
}

export function ReasonWeeklyChart({ data, reasons }: { data: ReportData["reasonMixWeekly"]; reasons: ReportData["byReason"] }) {
  const t = useTranslations("reports.charts");
  const locale = useLocale();
  const f = useReportFormat();
  const option = useMemo(() => {
    const used = reasons.filter((r) => data.some((w) => (w.counts[r.reasonId] ?? 0) > 0));
    return {
      ...baseOption(th),
      grid,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(
        data.map((w) => f.day(w.weekStart)),
        t("weekStarting"),
        { axisLabel: { color: th.muted, hideOverlap: true } },
      ),
      yAxis: valueAxis(t("visitors")),
      series: used.map((r) => ({
        name: pickText(r.name, locale),
        type: "bar",
        stack: "reasons",
        barMaxWidth: 44,
        itemStyle: { color: r.color },
        emphasis: { focus: "series" },
        data: data.map((w) => w.counts[r.reasonId] ?? 0),
      })),
    };
  }, [data, reasons, f, locale, t]);
  return <EChart option={option} height={300} ariaLabel={t("reasonWeekly")} />;
}

/* ─────────────── Heatmap ─────────────── */

export function PeakHeatmap({ data }: { data: ReportData["heatmap"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const max = Math.max(1, data.max || 0, ...data.cells.map((c) => c[2]));
    return {
      ...baseOption(th),
      grid: { left: 8, right: 16, top: 8, bottom: 64, containLabel: true },
      legend: noLegend,
      tooltip: {
        ...baseOption(th).tooltip,
        trigger: "item",
        formatter: (p: { value: [number, number, number] }) =>
          `${f.weekdayName(p.value[1], "long")} · ${f.hourLabel(p.value[0])}:00<br/><b>${f.num(p.value[2])}</b> ${t("visitors")}`,
      },
      xAxis: {
        type: "category",
        data: HOURS.map(f.hourLabel),
        name: t("hourOfDay"),
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: th.muted },
        splitArea: { show: false },
        ...axisStyle(th),
        splitLine: { show: false },
      },
      yAxis: {
        type: "category",
        data: WEEKDAYS.map((d) => f.weekdayName(d)),
        inverse: true,
        ...axisStyle(th),
        splitLine: { show: false },
      },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 12,
        itemHeight: 160,
        text: [f.num(max), "0"],
        textStyle: { color: th.textSecondary },
        inRange: { color: [th.grid, th.series[0]] },
        formatter: (v: number) => f.num(v),
      },
      series: [
        {
          name: t("visitors"),
          type: "heatmap",
          data: data.cells.map(([d, h, c]) => [h, d, c]),
          itemStyle: { borderColor: th.surface, borderWidth: 2, borderRadius: 2 },
          emphasis: { itemStyle: { borderColor: th.text } },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={330} ariaLabel={t("peakHeatmap")} />;
}

/* ─────────────── Queue ─────────────── */

export function QueueLengthChart({ data }: { data: ReportData["queueLengthByHour"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.hour, d]));
    return {
      ...baseOption(th),
      color: [th.series[0], th.series[1]],
      grid,
      tooltip: axisTooltip((_, v) => f.num(v, 1)),
      xAxis: categoryAxis(HOURS.map(f.hourLabel), t("hourOfDay"), { boundaryGap: false }),
      yAxis: valueAxis(t("waiting"), { minInterval: 0 }),
      series: [
        {
          name: t("avgWaiting"),
          type: "line",
          data: HOURS.map((h) => Number((by.get(h)?.avg ?? 0).toFixed(1))),
          symbolSize: 5,
          lineStyle: { width: 2 },
        },
        {
          name: t("maxWaiting"),
          type: "line",
          data: HOURS.map((h) => by.get(h)?.max ?? 0),
          symbolSize: 5,
          lineStyle: { width: 2, type: "dashed" },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={280} ariaLabel={t("queueLength")} />;
}

export function ThroughputChart({ data }: { data: ReportData["byHour"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.hour, d.served]));
    return {
      ...baseOption(th),
      color: [th.series[2]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(HOURS.map(f.hourLabel), t("hourOfDay")),
      yAxis: valueAxis(t("served")),
      series: [
        {
          name: t("served"),
          type: "bar",
          data: HOURS.map((h) => by.get(h) ?? 0),
          barMaxWidth: 24,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={260} ariaLabel={t("throughput")} />;
}

export function BacklogChart({ data }: { data: ReportData["backlogByDay"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[3]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(
        data.map((d) => f.day(d.date)),
        undefined,
        { axisLabel: { color: th.muted, hideOverlap: true } },
      ),
      yAxis: valueAxis(t("stillWaiting")),
      series: [
        {
          name: t("stillWaiting"),
          type: "bar",
          data: data.map((d) => d.count),
          barMaxWidth: 32,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [data, f, t],
  );
  return <EChart option={option} height={260} ariaLabel={t("backlog")} />;
}

/* ─────────────── Agents ─────────────── */

export function AgentServedChart({ data }: { data: ReportData["agents"] }) {
  const t = useTranslations("reports.charts");
  const locale = useLocale();
  const f = useReportFormat();
  const rows = useMemo(() => [...data].sort((a, b) => b.served - a.served), [data]);
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0]],
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      legend: noLegend,
      tooltip: { ...axisTooltip((_, v) => f.num(v)), axisPointer: { type: "none" } },
      xAxis: valueAxis("", { show: false, splitLine: { show: false } }),
      yAxis: categoryAxis(
        rows.map((r) => pickText(r.name, locale)),
        undefined,
        { inverse: true },
      ),
      series: [
        {
          name: t("served"),
          type: "bar",
          barMaxWidth: 22,
          data: rows.map((r) => r.served),
          itemStyle: { borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: "right", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    }),
    [rows, f, locale, t],
  );
  return <EChart option={option} height={Math.max(180, rows.length * 34 + 24)} ariaLabel={t("servedPerAgent")} />;
}

/* ─────────────── Forecast ─────────────── */

export function ForecastDaysChart({ data }: { data: Forecast["days"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(
        data.map((d) => `${f.weekdayName(d.weekday)} ${f.day(d.date)}`),
        undefined,
        { axisLabel: { color: th.muted, hideOverlap: true } },
      ),
      yAxis: valueAxis(t("expectedVisitors")),
      series: [
        {
          name: t("expectedVisitors"),
          type: "bar",
          data: data.map((d) => Math.round(d.expected)),
          barMaxWidth: 36,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    }),
    [data, f, t],
  );
  return <EChart option={option} height={260} ariaLabel={t("forecastDays")} />;
}

export function ForecastHoursChart({ data }: { data: Forecast["tomorrow"]["hours"] }) {
  const t = useTranslations("reports.charts");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.hour, d]));
    return {
      ...baseOption(th),
      color: [th.series[0], th.series[1]],
      grid,
      tooltip: axisTooltip((i, v) => f.num(v, i === 0 ? 1 : 0)),
      xAxis: categoryAxis(HOURS.map(f.hourLabel), t("hourOfDay")),
      yAxis: [
        valueAxis(t("expectedVisitors"), { minInterval: 0 }),
        valueAxis(t("suggestedAgents"), { splitLine: { show: false }, nameTextStyle: { color: th.muted, align: "right" } }),
      ],
      series: [
        {
          name: t("expectedVisitors"),
          type: "bar",
          data: HOURS.map((h) => Number((by.get(h)?.expected ?? 0).toFixed(1))),
          barMaxWidth: 24,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
        {
          name: t("suggestedAgents"),
          type: "line",
          step: "middle",
          yAxisIndex: 1,
          data: HOURS.map((h) => by.get(h)?.agentsNeeded ?? 0),
          symbol: "none",
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={280} ariaLabel={t("forecastHours")} />;
}

/* ─────────────── Repeat visits ─────────────── */

export function RepeatDistributionChart({ data }: { data: ReportData["repeat"]["distribution"] }) {
  const t = useTranslations("reports.repeat");
  const f = useReportFormat();
  const option = useMemo(() => {
    const by = new Map(data.map((d) => [d.visits, d.visitors]));
    const buckets = [1, 2, 3, 4, 5];
    return {
      ...baseOption(th),
      color: [th.series[0]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(
        buckets.map((n) => (n === 5 ? t("fivePlus", { n: f.num(5) }) : f.num(n))),
        t("visitsAxis"),
      ),
      yAxis: valueAxis(t("visitorsAxis")),
      series: [
        {
          name: t("visitorsAxis"),
          type: "bar",
          data: buckets.map((n) => by.get(n) ?? 0),
          barMaxWidth: 48,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    };
  }, [data, f, t]);
  return <EChart option={option} height={260} ariaLabel={t("distribution")} />;
}

/* ─────────────── Visitor satisfaction ─────────────── */

/** Answers per score, 1 to 5. */
export function CsatDistributionChart({ data }: { data: ReportData["csat"]["summary"]["distribution"] }) {
  const t = useTranslations("reports.csat");
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0]],
      grid,
      legend: noLegend,
      tooltip: axisTooltip((_, v) => f.num(v)),
      xAxis: categoryAxis(
        data.map((d) => f.num(d.score)),
        t("scoreAxis"),
      ),
      yAxis: valueAxis(t("responsesAxis")),
      series: [
        {
          name: t("responsesAxis"),
          type: "bar",
          data: data.map((d) => d.count),
          barMaxWidth: 48,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: "top", color: th.textSecondary, formatter: (p: { value: number }) => f.num(p.value) },
        },
      ],
    }),
    [data, f, t],
  );
  return <EChart option={option} height={260} ariaLabel={t("distribution")} />;
}

/** Average score and number of answers per day. */
export function CsatTrendChart({ data }: { data: ReportData["csat"]["byDay"] }) {
  const t = useTranslations("reports.csat");
  const f = useReportFormat();
  const option = useMemo(
    () => ({
      ...baseOption(th),
      color: [th.series[0], th.series[1]],
      grid,
      tooltip: axisTooltip((i, v) => (i === 0 ? f.num(v, 2) : f.num(v))),
      xAxis: categoryAxis(
        data.map((d) => f.day(d.date)),
        undefined,
        { axisLabel: { color: th.muted, hideOverlap: true } },
      ),
      yAxis: [
        valueAxis(t("avgAxis"), { min: 1, max: 5, minInterval: 1 }),
        valueAxis(t("responsesAxis"), { splitLine: { show: false } }),
      ],
      series: [
        {
          name: t("avgAxis"),
          type: "line",
          connectNulls: true,
          data: data.map((d) => d.avg),
          symbolSize: 6,
          lineStyle: { width: 2 },
        },
        {
          name: t("responsesAxis"),
          type: "bar",
          yAxisIndex: 1,
          data: data.map((d) => d.responses),
          barMaxWidth: 28,
          itemStyle: { borderRadius: [3, 3, 0, 0], opacity: 0.35 },
        },
      ],
    }),
    [data, f, t],
  );
  return <EChart option={option} height={280} ariaLabel={t("trend")} />;
}
