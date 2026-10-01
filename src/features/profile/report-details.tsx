"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import type { AgentReport } from "@/domain/profile/agent-report";
import { pickText } from "@/i18n/locales";
import { api } from "@/lib/api";
import type { DetailRow } from "@/server/profile/report";
import { useReportFormat } from "./report-parts";

type Page = { items: DetailRow[]; next: string | null; feedbackOn: boolean };

/** Served-visitors detail report: a table of the agent's finished visits, filterable, with "load more". */
export function ReportDetails({ query, report }: { query: string; report: AgentReport }) {
  const t = useTranslations("profile.reports.details");
  const tr = useTranslations("profile.reports");
  const locale = useLocale();
  const format = useFormatter();
  const f = useReportFormat();
  const [outcome, setOutcome] = useState("");
  const [reasonId, setReasonId] = useState("");

  const q = useInfiniteQuery({
    queryKey: ["me-report-details", query, outcome, reasonId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/api/v1/me/report/details?${query}${outcome ? `&outcome=${outcome}` : ""}${reasonId ? `&reasonId=${reasonId}` : ""}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) => last.next,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const showScore = report.csat !== null;
  const time = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone: report.range.timezone }) : "—";
  const dayOf = (iso: string) =>
    format.dateTime(new Date(iso), { month: "short", day: "numeric", timeZone: report.range.timezone });

  const head = [
    t("number"),
    t("reason"),
    t("visitor"),
    t("arrived"),
    t("called"),
    t("started"),
    t("finished"),
    t("wait"),
    t("service"),
    t("outcome"),
    ...(showScore ? [t("score")] : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="no-print flex flex-wrap gap-2">
          <NativeSelect
            className="w-auto"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            aria-label={t("filterOutcome")}
          >
            <option value="">
              {t("filterOutcome")}: {t("all")}
            </option>
            <option value="COMPLETED">{t("outcomes.COMPLETED")}</option>
            <option value="NO_SHOW">{t("outcomes.NO_SHOW")}</option>
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            aria-label={t("filterReason")}
          >
            <option value="">
              {t("filterReason")}: {t("all")}
            </option>
            {report.byReason.map((r) => (
              <option key={r.reasonId} value={r.reasonId}>
                {pickText(r.name, locale, "—")}
              </option>
            ))}
          </NativeSelect>
        </div>

        {q.isPending ? (
          <p className="text-muted-foreground text-sm">{tr("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  {head.map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 text-start font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-2 py-2 font-semibold whitespace-nowrap" dir="ltr">
                      {r.displayNumber}
                    </td>
                    <td className="px-2 py-2">{pickText(r.reason, locale, "—")}</td>
                    <td className="px-2 py-2">
                      {r.visitorName || r.visitorPhone ? (
                        <>
                          {r.visitorName}
                          {r.visitorPhone && (
                            <span className="text-muted-foreground block text-xs" dir="ltr">
                              {r.visitorPhone}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                      <span className="text-muted-foreground text-xs">{dayOf(r.arrivedAt)} </span>
                      {time(r.arrivedAt)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{time(r.calledAt)}</td>
                    <td className="px-2 py-2 tabular-nums">{time(r.startedAt)}</td>
                    <td className="px-2 py-2 tabular-nums">{time(r.finishedAt)}</td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">{f.mins(r.waitMin)}</td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">{f.mins(r.serviceMin)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {t(`outcomes.${r.status}`)}
                      {r.outcome && <span className="text-muted-foreground text-xs"> · {r.outcome}</span>}
                    </td>
                    {showScore && <td className="px-2 py-2 tabular-nums">{r.score ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {q.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="no-print"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {t("loadMore")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
