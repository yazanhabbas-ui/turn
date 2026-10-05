"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/admin/form";
import { api } from "@/components/admin/use-api";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { defaultRange, todayIn } from "./filters";

type L = Record<string, string>;
type Rating = {
  id: string;
  at: string;
  displayNumber: string;
  score: number;
  comment: string | null;
  source: string;
  visitor: { name: string | null; phoneMasked: string | null; phone: string | null };
  desk: { number: string; name: L } | null;
  agent: { id: string; name: L } | null;
};
type Response = { timezone: string; truncated: boolean; items: Rating[]; agents: { id: string; name: L }[] };

function RatingStars({ score, label }: { score: number; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("size-4", n <= score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
          aria-hidden
        />
      ))}
    </span>
  );
}

const SOURCES = ["reception", "kiosk", "agent", "appointment", "api"];

/**
 * Visitor ratings with who rated (name / phone recorded by the reception or kiosk), desk, agent, score and comment.
 * Filter by agent and date range; used on the supervisor dashboard and in the reports "Ratings" tab.
 * With `from`/`to` the range follows the caller (the reports filters); without them the panel has its own date pickers.
 */
export function RatingsPanel({ from, to, branchId }: { from?: string; to?: string; branchId?: string }) {
  const t = useTranslations("reports.ratings");
  const locale = useLocale();
  const format = useFormatter();
  const [range, setRange] = useState(() => defaultRange(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [agentId, setAgentId] = useState("");
  const fixed = from !== undefined && to !== undefined;
  const f = fixed ? { from: from!, to: to! } : range;

  const qs = new URLSearchParams({ from: f.from, to: f.to });
  if (branchId) qs.set("branchId", branchId);
  if (agentId) qs.set("agentId", agentId);
  const q = useQuery({
    queryKey: ["reports", "ratings", qs.toString()],
    queryFn: () => api<Response>(`/api/v1/reports/ratings?${qs}`),
    placeholderData: keepPreviousData,
  });

  const timeZone = q.data?.timezone;
  const fmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
    } catch {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    }
  }, [locale, timeZone]);

  const items = q.data?.items ?? [];
  const avg = items.length ? items.reduce((s, r) => s + r.score, 0) / items.length : null;
  const sourceLabel = (s: string) => (SOURCES.includes(s) ? t(`sources.${s}`) : s);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium">
          {t("agent")}
          <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} className="min-w-48">
            <option value="">{t("allAgents")}</option>
            {q.data?.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {pickText(a.name, locale, "—")}
              </option>
            ))}
          </NativeSelect>
        </label>
        {!fixed && (
          <>
            <label className="grid gap-1 text-xs font-medium">
              {t("from")}
              <Input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              {t("to")}
              <Input
                type="date"
                value={range.to}
                min={range.from}
                max={todayIn(timeZone ?? "UTC")}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </label>
          </>
        )}
        {avg !== null && (
          <p className="text-muted-foreground ms-auto text-sm">
            {t("summary", { n: format.number(items.length), avg: format.number(avg, { maximumFractionDigits: 1 }) })}
          </p>
        )}
      </div>

      {q.isError && !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <>
          <ul className={cn("space-y-2 md:hidden", q.isPlaceholderData && "opacity-60")}>
            {items.map((r) => {
              const phone = r.visitor.phone ?? r.visitor.phoneMasked;
              const desk = r.desk ? [r.desk.number, pickText(r.desk.name, locale, "")].filter(Boolean).join(" · ") : "—";
              return (
                <li key={r.id} className="bg-card rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular font-semibold" dir="ltr">
                      {r.displayNumber}
                    </span>
                    <RatingStars score={r.score} label={t("score", { n: r.score })} />
                  </div>
                  <p className="text-muted-foreground tabular text-xs">{fmt.format(new Date(r.at))}</p>
                  <p className="mt-2 text-sm">
                    {r.visitor.name || "—"}
                    {phone && (
                      <span className="text-muted-foreground ms-2 text-xs" dir="ltr">
                        {phone}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {[r.agent ? pickText(r.agent.name, locale, "—") : "—", t("deskN", { desk }), sourceLabel(r.source)].join(
                      " · ",
                    )}
                  </p>
                  {r.comment && <p className="mt-2 text-sm break-words">{r.comment}</p>}
                </li>
              );
            })}
          </ul>
          <div className={cn("hidden overflow-x-auto md:block", q.isPlaceholderData && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("cols.ticket")}</TableHead>
                  <TableHead>{t("cols.visitor")}</TableHead>
                  <TableHead>{t("cols.deskAgent")}</TableHead>
                  <TableHead>{t("cols.rating")}</TableHead>
                  <TableHead>{t("cols.comment")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => {
                  const phone = r.visitor.phone ?? r.visitor.phoneMasked;
                  const desk = r.desk ? [r.desk.number, pickText(r.desk.name, locale, "")].filter(Boolean).join(" · ") : "—";
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap">
                        <div className="tabular font-medium" dir="ltr">
                          {r.displayNumber}
                        </div>
                        <div className="text-muted-foreground tabular text-xs">{fmt.format(new Date(r.at))}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div>{r.visitor.name || "—"}</div>
                        <div className="text-muted-foreground text-xs">
                          {phone && (
                            <span dir="ltr" className="me-2">
                              {phone}
                            </span>
                          )}
                          {sourceLabel(r.source)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div>{r.agent ? pickText(r.agent.name, locale, "—") : "—"}</div>
                        <div className="text-muted-foreground text-xs">{t("deskN", { desk })}</div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-0.5" role="img" aria-label={t("score", { n: r.score })}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={cn(
                                "size-4",
                                n <= r.score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                              )}
                              aria-hidden
                            />
                          ))}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-56 whitespace-normal">
                        {r.comment || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {q.data.truncated && <p className="text-muted-foreground mt-2 text-xs">{t("truncated")}</p>}
        </>
      )}
    </div>
  );
}
