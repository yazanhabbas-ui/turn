"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CHART_THEME } from "@/components/charts/echart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentReport, ReasonReport } from "@/domain/reports/types";
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
type AgentSortKey = AgentCol | "name";

const MINUTE_COLS = new Set<AgentCol>([
  "avgServiceMin",
  "medianServiceMin",
  "p90ServiceMin",
  "loginMin",
  "breakMin",
  "servingMin",
  "idleMin",
]);

export function AgentsTable({ agents }: { agents: AgentReport[] }) {
  const t = useTranslations("reports.agents");
  const locale = useLocale();
  const f = useReportFormat();
  const { sort, toggle } = useSort<AgentSortKey>("served");

  const rows = useMemo(() => {
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...agents].sort((a, b) =>
      sort.key === "name"
        ? mult * pickText(a.name, locale).localeCompare(pickText(b.name, locale), locale)
        : mult * (a[sort.key] - b[sort.key]),
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
            {AGENT_COLS.map((c) => (
              <SortHead key={c} label={t(`cols.${c}`)} active={sort.key === c} dir={sort.dir} onClick={() => toggle(c)} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.agentId}>
              <TableCell className="font-medium whitespace-nowrap">{pickText(a.name, locale)}</TableCell>
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
