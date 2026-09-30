"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CHART_THEME } from "@/components/charts/echart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentReport, CsatGroup, LowScoreComment, ReasonReport, RepeatVisitor, ShiftReport } from "@/domain/reports/types";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { useReportFormat } from "./use-report-format";

type SortDir = "asc" | "desc";

function useSort<K extends string>(initial: K) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir: "desc" });
  const toggle = (key: K) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === ("name" as K) ? "asc" : "desc" },
    );
  return { sort, toggle };
}

function SortHead({
  label,
  active,
  dir,
  onClick,
  numeric = true,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  numeric?: boolean;
}) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn(numeric && "text-end")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap",
          numeric && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "invisible")} aria-hidden />
      </button>
    </TableHead>
  );
}

const AGENT_COLS = [
  "served",
  "noShow",
  "transferOut",
  "transferIn",
  "avgServiceMin",
  "medianServiceMin",
  "p90ServiceMin",
  "loginMin",
  "breakMin",
  "servingMin",
  "idleMin",
  "utilisationPct",
] as const;
type AgentCol = (typeof AGENT_COLS)[number];
type AgentSortKey = AgentCol | "name" | "csatAvg";

const MINUTE_COLS = new Set<AgentCol>([
  "avgServiceMin",
  "medianServiceMin",
  "p90ServiceMin",
  "loginMin",
  "breakMin",
  "servingMin",
  "idleMin",
]);

export function AgentsTable({ agents, shifts = [] }: { agents: AgentReport[]; shifts?: ShiftReport[] }) {
  const t = useTranslations("reports.agents");
  const locale = useLocale();
  const f = useReportFormat();
  const { sort, toggle } = useSort<AgentSortKey>("served");
  const showShift = shifts.length > 0;
  const shiftName = (id: string | null) => {
    const sh = id ? shifts.find((x) => x.shiftId === id) : null;
    return sh ? pickText(sh.name, locale) : null;
  };

  const rows = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...agents].sort((a, b) =>
      sort.key === "name"
        ? mult * pickText(a.name, locale).localeCompare(pickText(b.name, locale), locale)
        : mult * ((a[sort.key] ?? -1) - (b[sort.key] ?? -1)),
    );
  }, [agents, sort, locale]);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead
              label={t("name")}
              numeric={false}
              active={sort.key === "name"}
              dir={sort.dir}
              onClick={() => toggle("name")}
            />
            {showShift && <TableHead>{t("shift")}</TableHead>}
            {AGENT_COLS.map((c) => (
              <SortHead key={c} label={t(`cols.${c}`)} active={sort.key === c} dir={sort.dir} onClick={() => toggle(c)} />
            ))}
            <SortHead
              label={t("cols.csatAvg")}
              active={sort.key === "csatAvg"}
              dir={sort.dir}
              onClick={() => toggle("csatAvg")}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.agentId}>
              <TableCell className="font-medium whitespace-nowrap">{pickText(a.name, locale)}</TableCell>
              {showShift && (
                <TableCell className="whitespace-nowrap">
                  {shiftName(a.shiftId) ? (
                    <span className="bg-muted text-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium">
                      {shiftName(a.shiftId)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              {AGENT_COLS.map((c) =>
                c === "utilisationPct" ? (
                  <TableCell key={c} className="text-end">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular">{f.pct(a[c], 0)}</span>
                      <span className="bg-muted inline-block h-2 w-16 overflow-hidden rounded-full" aria-hidden>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, a[c]))}%`, backgroundColor: CHART_THEME.light.series[0] }}
                        />
                      </span>
                    </div>
                  </TableCell>
                ) : (
                  <TableCell key={c} className="tabular text-end whitespace-nowrap">
                    {MINUTE_COLS.has(c) ? f.minutes(a[c]) : f.num(a[c])}
                  </TableCell>
                ),
              )}
              <TableCell className="tabular text-end whitespace-nowrap">
                {a.csatAvg === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    {f.num(a.csatAvg, 1)} <span className="text-muted-foreground text-xs">({f.num(a.csatResponses)})</span>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const REASON_COLS = ["visitors", "served", "avgWaitMin", "p90WaitMin", "avgServiceMin", "p90ServiceMin", "slaPct"] as const;
type ReasonCol = (typeof REASON_COLS)[number];
type ReasonSortKey = ReasonCol | "name";

export function ReasonsTable({ reasons }: { reasons: ReasonReport[] }) {
  const t = useTranslations("reports.reasons");
  const locale = useLocale();
  const f = useReportFormat();
  const { sort, toggle } = useSort<ReasonSortKey>("visitors");

  const rows = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...reasons].sort((a, b) =>
      sort.key === "name"
        ? mult * pickText(a.name, locale).localeCompare(pickText(b.name, locale), locale)
        : mult * (a[sort.key] - b[sort.key]),
    );
  }, [reasons, sort, locale]);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead
              label={t("name")}
              numeric={false}
              active={sort.key === "name"}
              dir={sort.dir}
              onClick={() => toggle("name")}
            />
            {REASON_COLS.map((c) => (
              <SortHead key={c} label={t(`cols.${c}`)} active={sort.key === c} dir={sort.dir} onClick={() => toggle(c)} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.reasonId}>
              <TableCell className="font-medium whitespace-nowrap">
                <span
                  className="me-2 inline-block size-2.5 rounded-full align-middle"
                  style={{ backgroundColor: r.color }}
                  aria-hidden
                />
                {pickText(r.name, locale)}
              </TableCell>
              {REASON_COLS.map((c) => (
                <TableCell key={c} className="tabular text-end whitespace-nowrap">
                  {c === "visitors" || c === "served" ? f.num(r[c]) : c === "slaPct" ? f.pct(r[c], 0) : f.minutes(r[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─────────────── Shifts ─────────────── */

export function ShiftsTable({ shifts }: { shifts: ShiftReport[] }) {
  const t = useTranslations("reports.shifts");
  const locale = useLocale();
  const f = useReportFormat();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead className="text-end">{t("visitors")}</TableHead>
            <TableHead className="text-end">{t("served")}</TableHead>
            <TableHead className="text-end">{t("avgWaitMin")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shifts.map((s) => (
            <TableRow key={s.shiftId ?? "none"}>
              <TableCell className="font-medium whitespace-nowrap">
                {s.shiftId === null ? t("outside") : pickText(s.name, locale)}
              </TableCell>
              <TableCell className="tabular text-end">{f.num(s.visitors)}</TableCell>
              <TableCell className="tabular text-end">{f.num(s.served)}</TableCell>
              <TableCell className="tabular text-end whitespace-nowrap">{f.minutes(s.avgWaitMin)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─────────────── Returning visitors ─────────────── */

const REPEAT_COLS = ["visits", "firstAt", "lastAt", "avgDaysBetween"] as const;
type RepeatSortKey = (typeof REPEAT_COLS)[number] | "name";

export function RepeatVisitorsTable({
  visitors,
  reasons,
  timeZone,
}: {
  visitors: RepeatVisitor[];
  reasons: { id: string; name: Record<string, string>; color: string }[];
  timeZone: string;
}) {
  const t = useTranslations("reports.repeat");
  const locale = useLocale();
  const f = useReportFormat();
  const { sort, toggle } = useSort<RepeatSortKey>("visits");
  const reasonById = useMemo(() => new Map(reasons.map((r) => [r.id, r])), [reasons]);
  const date = useMemo(() => {
    let fmt: Intl.DateTimeFormat;
    try {
      fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });
    } catch {
      fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    }
    return (ms: number) => fmt.format(new Date(ms));
  }, [locale, timeZone]);

  const rows = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...visitors].sort((a, b) =>
      sort.key === "name"
        ? mult * (a.name ?? "").localeCompare(b.name ?? "", locale)
        : mult * (a[sort.key] - b[sort.key]) || b.lastAt - a.lastAt,
    );
  }, [visitors, sort, locale]);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead
              label={t("cols.name")}
              numeric={false}
              active={sort.key === "name"}
              dir={sort.dir}
              onClick={() => toggle("name")}
            />
            <TableHead>{t("cols.mobile")}</TableHead>
            {REPEAT_COLS.map((c) => (
              <SortHead key={c} label={t(`cols.${c}`)} active={sort.key === c} dir={sort.dir} onClick={() => toggle(c)} />
            ))}
            <TableHead>{t("cols.reasons")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((v) => (
            <TableRow key={v.visitorId}>
              <TableCell className="font-medium whitespace-nowrap">
                {v.name || <span className="text-muted-foreground font-normal">{t("notIdentified")}</span>}
              </TableCell>
              <TableCell className="tabular whitespace-nowrap">
                <bdi dir="ltr">{v.phone ?? v.phoneMasked ?? "—"}</bdi>
              </TableCell>
              <TableCell className="tabular text-end">{f.num(v.visits)}</TableCell>
              <TableCell className="tabular text-end whitespace-nowrap">{date(v.firstAt)}</TableCell>
              <TableCell className="tabular text-end whitespace-nowrap">{date(v.lastAt)}</TableCell>
              <TableCell className="tabular text-end whitespace-nowrap">{f.num(v.avgDaysBetween, 1)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {v.reasonIds.map((id) => {
                    const r = reasonById.get(id);
                    if (!r) return null;
                    return (
                      <span
                        key={id}
                        className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
                      >
                        <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                        {pickText(r.name, locale)}
                      </span>
                    );
                  })}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─────────────── Visitor satisfaction ─────────────── */

/** Satisfaction by agent, reason, branch or shift (one table per grouping). */
export function CsatGroupTable({ groups, outsideLabel }: { groups: CsatGroup[]; outsideLabel: string }) {
  const t = useTranslations("reports.csat");
  const locale = useLocale();
  const f = useReportFormat();
  const rows = useMemo(() => [...groups].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.responses - a.responses), [groups]);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("cols.name")}</TableHead>
            <TableHead className="text-end">{t("cols.responses")}</TableHead>
            <TableHead className="text-end">{t("cols.avg")}</TableHead>
            <TableHead className="text-end">{t("cols.satisfied")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((g) => (
            <TableRow key={g.key ?? "none"}>
              <TableCell className="font-medium whitespace-nowrap">
                {g.key === null && !Object.keys(g.name).length ? outsideLabel : pickText(g.name, locale)}
              </TableCell>
              <TableCell className="tabular text-end">{f.num(g.responses)}</TableCell>
              <TableCell className="tabular text-end">{g.avg === null ? "—" : f.num(g.avg, 1)}</TableCell>
              <TableCell className="tabular text-end">{f.pct(g.satisfiedPct, 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Latest low scores that came with a comment. The visitor's name and number are masked as in the repeat-visits table. */
export function LowCommentsTable({
  comments,
  agents,
  reasons,
  timeZone,
}: {
  comments: LowScoreComment[];
  agents: AgentReport[];
  reasons: { id: string; name: Record<string, string> }[];
  timeZone: string;
}) {
  const t = useTranslations("reports.csat");
  const locale = useLocale();
  const f = useReportFormat();
  const agentName = (id: string | null) => pickText(agents.find((a) => a.agentId === id)?.name, locale, "—");
  const reasonName = (id: string) => pickText(reasons.find((r) => r.id === id)?.name, locale, "—");
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  } catch {
    fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("cols.time")}</TableHead>
            <TableHead className="text-end">{t("cols.score")}</TableHead>
            <TableHead>{t("cols.comment")}</TableHead>
            <TableHead>{t("cols.ticket")}</TableHead>
            <TableHead>{t("cols.agent")}</TableHead>
            <TableHead>{t("cols.reason")}</TableHead>
            <TableHead>{t("cols.visitor")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comments.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="tabular whitespace-nowrap">{fmt.format(new Date(c.at))}</TableCell>
              <TableCell className="tabular text-end">{f.num(c.score)}</TableCell>
              <TableCell className="min-w-56 whitespace-normal">{c.comment}</TableCell>
              <TableCell className="tabular whitespace-nowrap" dir="ltr">
                {c.displayNumber}
              </TableCell>
              <TableCell className="whitespace-nowrap">{agentName(c.agentId)}</TableCell>
              <TableCell className="whitespace-nowrap">{reasonName(c.reasonId)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {c.name || <span className="text-muted-foreground">{t("notIdentified")}</span>}
                {(c.phone ?? c.phoneMasked) && (
                  <div className="tabular text-muted-foreground text-xs">
                    <bdi dir="ltr">{c.phone ?? c.phoneMasked}</bdi>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
