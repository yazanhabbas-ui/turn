import type { ReportData } from "@/domain/reports/types";

export const MAX_DAYS = 92;

export type ReportFilterState = {
  from: string;
  to: string;
  branchId: string;
  reasonId: string;
  agentId: string;
  hallId: string;
  weekdays: number[];
  hourFrom: number | null;
  hourTo: number | null;
};

export type ReportMeta = {
  branches: { id: string; name: Record<string, string>; timezone: string }[];
  reasons: { id: string; name: Record<string, string>; color: string }[];
  agents: { id: string; name: Record<string, string> }[];
  /** Halls of the visible branches (D62); empty when there are none. */
  halls?: { id: string; branchId: string; number: string; name: Record<string, string> }[];
};

export type OverviewResponse = {
  timezone: string;
  generatedAt: string;
  data: ReportData;
  meta: ReportMeta;
};

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export type Preset = "today" | "yesterday" | "last7" | "last30" | "thisMonth";
export const PRESETS: Preset[] = ["today", "yesterday", "last7", "last30", "thisMonth"];

export function presetRange(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

export function defaultRange(timeZone: string) {
  return presetRange("last7", todayIn(timeZone));
}

/** Reads the filters from the URL. Missing dates are left empty; the caller fills them with the branch's "today". */
export function parseFilters(params: URLSearchParams): Omit<ReportFilterState, "from" | "to"> & { from: string; to: string } {
  const int = (k: string, max: number) => {
    const raw = params.get(k);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
  };
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    from: ISO.test(from) ? from : "",
    to: ISO.test(to) ? to : "",
    branchId: params.get("branchId") ?? "",
    reasonId: params.get("reasonId") ?? "",
    agentId: params.get("agentId") ?? "",
    hallId: params.get("hallId") ?? "",
    weekdays: (params.get("weekdays") ?? "")
      .split(",")
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    hourFrom: int("hourFrom", 23),
    hourTo: int("hourTo", 23),
  };
}

/** Query string (no leading "?") for the API and for the shareable page URL. */
export function toQuery(f: ReportFilterState): string {
  const q = new URLSearchParams();
  q.set("from", f.from);
  q.set("to", f.to);
  if (f.branchId) q.set("branchId", f.branchId);
  if (f.reasonId) q.set("reasonId", f.reasonId);
  if (f.agentId) q.set("agentId", f.agentId);
  if (f.hallId) q.set("hallId", f.hallId);
  if (f.weekdays.length && f.weekdays.length < 7) q.set("weekdays", [...f.weekdays].sort().join(","));
  if (f.hourFrom !== null) q.set("hourFrom", String(f.hourFrom));
  if (f.hourTo !== null) q.set("hourTo", String(f.hourTo));
  return q.toString();
}
