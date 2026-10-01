"use client";

import { Download, Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useApiQuery } from "@/components/admin/use-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_REPORT_DAYS, REPORT_PRESETS, customRange, type AgentReport, type ReportPreset } from "@/domain/profile/agent-report";
import { cn } from "@/lib/utils";
import { ReportDetails } from "./report-details";
import {
  ComparisonTable,
  DailyTable,
  DistributionChart,
  HourChart,
  ReasonTable,
  SatisfactionBlock,
  useReportFormat,
} from "./report-parts";

type Mode = ReportPreset | "custom";

/**
 * "My reports" (agents only, D55): the agent's own work for today, this week, this month or a custom range of up to
 * 92 days. Tables and charts only, no event log. Download as CSV, Excel or PDF, or print (A4, light).
 */
export function ReportsPanel() {
  const t = useTranslations("profile.reports");
  const locale = useLocale();
  const f = useReportFormat();
  const [mode, setMode] = useState<Mode>("week");
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);

  const valid = customRange(draft.from, draft.to) !== null;
  const query = mode === "custom" ? (applied ? `from=${applied.from}&to=${applied.to}` : null) : `period=${mode}`;
  const q = useApiQuery<AgentReport>(query ? `/api/v1/me/report?${query}` : null);
  const r = q.data;

  const print = () => {
    // The reports stylesheet (light, A4, controls hidden) is keyed on this body class.
    document.body.classList.add("reports-print");
    window.addEventListener("afterprint", () => document.body.classList.remove("reports-print"), { once: true });
    window.print();
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("hint")}</p>

      <div className="no-print flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label={t("period.label")} className="bg-muted inline-flex rounded-lg p-1">
          {[...REPORT_PRESETS, "custom" as const].map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium",
                mode === k ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {t(`period.${k}`)}
            </button>
          ))}
        </div>
        {mode === "custom" && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) setApplied({ ...draft });
            }}
          >
            <label className="text-sm">
              <span className="text-muted-foreground block text-xs">{t("period.from")}</span>
              <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} dir="ltr" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground block text-xs">{t("period.to")}</span>
              <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} dir="ltr" />
            </label>
            <Button type="submit" size="sm" disabled={!valid}>
              {t("period.apply")}
            </Button>
            {draft.from && draft.to && !valid && (
              <p className="text-destructive w-full text-xs">{t("period.invalid", { max: MAX_REPORT_DAYS })}</p>
            )}
          </form>
        )}
      </div>

      {q.isPending && query && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {q.isError && <p className="text-destructive text-sm">{t("error")}</p>}

      {r && query && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("period.shown", { from: f.day(r.range.from), to: f.day(r.range.to) })}</p>
            <div className="no-print flex flex-wrap items-center gap-2">
              {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                <a
                  key={fmt}
                  href={`/api/v1/me/report/export?${query}&format=${fmt}&lang=${locale}`}
                  download
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Download className="size-4" aria-hidden />
                  {t(`download.${fmt}`)}
                </a>
              ))}
              <Button variant="outline" size="sm" onClick={print}>
                <Printer className="size-4" aria-hidden />
                {t("download.print")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [t("summary.served"), f.int(r.totals.served)],
              [t("summary.noShows"), f.int(r.totals.noShows)],
              [t("summary.avgService"), f.mins(r.totals.avgServiceMin)],
              [t("summary.avgWait"), f.mins(r.totals.avgWaitMin)],
            ].map(([label, value]) => (
              <div key={label} className="bg-card rounded-xl border p-4">
                <div className="text-muted-foreground text-sm">{label}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <DailyTable report={r} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ReasonTable report={r} />
            <HourChart report={r} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionChart report={r} />
            <ComparisonTable report={r} />
          </div>
          <SatisfactionBlock report={r} />
          <ReportDetails query={query} report={r} />
        </>
      )}
    </div>
  );
}
