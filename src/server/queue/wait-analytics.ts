import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  estimateWait,
  resolveServiceMinutes,
  summarizeSamples,
  type SampleMoment,
  type ServiceMinutes,
  type ServiceSample,
  type WaitEstimate,
} from "@/domain/distribution/estimate";
import { now as clockNow } from "../clock";
import type { SettingValue } from "../settings/registry";
import { getSetting } from "../settings/service";

export type WaitSettings = SettingValue<"waitEstimate">;

/** Completed services are re-read at most this often per branch. */
const CACHE_MS = 5 * 60_000;
/** Safety cap on the services read for one branch. */
const MAX_ROWS = 50_000;

type Cached = { at: number; byReason: Map<string, ServiceSample[]> };
const cache = new Map<string, Cached>();

/** Forgets the learned durations (tests, and after changing how they are read). */
export function clearWaitAnalyticsCache() {
  cache.clear();
}

/** Weekday (0 = Sunday) and hour of a moment in a time zone. */
export function momentIn(timeZone: string, at: number): SampleMoment {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(
    new Date(at),
  );
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return { hour, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}

/**
 * Lengths of the completed services of a branch (or, without a branch, of the whole organization) over the last
 * `lookbackDays`, by reason. One light aggregate-free scan of finished tickets.
 */
export async function readServiceSamples(
  tx: DbOrTx,
  scope: { branchId?: string | null; organizationId: string; timezone: string },
  lookbackDays: number,
  at: number,
): Promise<Map<string, ServiceSample[]>> {
  const since = new Date(at - lookbackDays * 86_400_000);
  const rows = await tx.execute<{ reason_id: string; minutes: number; hour: number; dow: number }>(sql`
    select reason_id,
           extract(epoch from (finished_at - started_at)) / 60.0 as minutes,
           extract(hour from started_at at time zone ${scope.timezone})::int as hour,
           extract(dow from started_at at time zone ${scope.timezone})::int as dow
    from tickets
    where status = 'COMPLETED'
      and started_at is not null and finished_at is not null and finished_at > started_at
      and finished_at >= ${since} and finished_at <= ${new Date(at)}
      and ${scope.branchId ? sql`branch_id = ${scope.branchId}` : sql`organization_id = ${scope.organizationId}`}
    order by finished_at desc
    limit ${MAX_ROWS}`);
  const out = new Map<string, ServiceSample[]>();
  for (const r of rows.rows) {
    const list = out.get(r.reason_id) ?? [];
    list.push({ minutes: Number(r.minutes), hour: Number(r.hour), dow: Number(r.dow) });
    out.set(r.reason_id, list);
  }
  return out;
}

/** Cached samples of a branch; a failure never propagates (the caller falls back to the reason's own time). */
async function cachedSamples(
  tx: DbOrTx,
  branch: { id: string; organizationId: string; timezone: string },
  lookbackDays: number,
  at: number,
): Promise<Map<string, ServiceSample[]>> {
  const key = `${branch.id}:${lookbackDays}`;
  const hit = cache.get(key);
  if (hit && at - hit.at < CACHE_MS && at >= hit.at) return hit.byReason;
  try {
    // A savepoint keeps a failed read from poisoning the surrounding issuing transaction.
    const byReason = await tx.transaction((sp) =>
      readServiceSamples(
        sp,
        { branchId: branch.id, organizationId: branch.organizationId, timezone: branch.timezone },
        lookbackDays,
        at,
      ),
    );
    cache.set(key, { at, byReason });
    return byReason;
  } catch (e) {
    console.error("wait analytics failed; using the reasons' own times", e);
    return hit?.byReason ?? new Map();
  }
}

export type WaitModel = {
  settings: WaitSettings;
  /** Minutes one visitor takes for a reason under the current settings. */
  serviceMinutes: (reasonId: string) => ServiceMinutes;
  /** The estimate for a visitor with `ahead` people in front in the reason's queue served by `agents` agents. */
  estimate: (reasonId: string, ahead: number, agents: number) => WaitEstimate;
};

/** Everything needed to estimate waits of one branch: the setting plus, in analytics mode, the learned durations. */
export async function buildWaitModel(
  tx: DbOrTx,
  branch: { id: string; organizationId: string; timezone: string },
  reasonExpected: (reasonId: string) => number,
  at: number = clockNow(),
): Promise<WaitModel> {
  const settings = await getSetting(branch.organizationId, "waitEstimate", branch.id, tx);
  const samples = settings.mode === "analytics" ? await cachedSamples(tx, branch, settings.lookbackDays, at) : new Map();
  const moment = momentIn(branch.timezone, at);
  const memo = new Map<string, ServiceMinutes>();
  const serviceMinutes = (reasonId: string) => {
    let m = memo.get(reasonId);
    if (!m) {
      m = resolveServiceMinutes(settings, reasonExpected(reasonId), samples.get(reasonId) ?? [], moment);
      memo.set(reasonId, m);
    }
    return m;
  };
  return {
    settings,
    serviceMinutes,
    estimate: (reasonId, ahead, agents) => estimateWait(ahead, agents, serviceMinutes(reasonId), settings),
  };
}

export type ReasonWaitStats = {
  reasonId: string;
  samples: number;
  average: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  expectedMinutes: number;
  /** Minutes per visitor the estimate uses right now. */
  usedMinutes: number;
  source: ServiceMinutes["source"];
};

/** For the admin table: what real data says for each reason next to the configured time and the time in use. */
export async function reasonWaitStats(
  tx: DbOrTx,
  scope: { branchId: string | null; organizationId: string; timezone: string },
  settings: WaitSettings,
  reasons: { id: string; expectedMinutes: number }[],
): Promise<ReasonWaitStats[]> {
  const at = clockNow();
  const samples = await readServiceSamples(tx, scope, settings.lookbackDays, at);
  const moment = momentIn(scope.timezone, at);
  return reasons.map((r) => {
    const list = samples.get(r.id) ?? [];
    const s = summarizeSamples(
      list.map((x) => x.minutes),
      settings,
    );
    // Shown whatever the mode is: "used" is what the analytics rule would use (the reason's time while learning).
    const used = resolveServiceMinutes({ ...settings, mode: "analytics" }, r.expectedMinutes, list, moment);
    return {
      reasonId: r.id,
      samples: s.n,
      average: s.n ? s.average : null,
      median: s.n ? s.median : null,
      p25: s.n ? s.p25 : null,
      p75: s.n ? s.p75 : null,
      expectedMinutes: r.expectedMinutes,
      usedMinutes: used.minutes,
      source: used.source,
    };
  });
}

/** The wording part of the setting, sent to the reception console, the ticket and the visitor page. */
export function waitDisplayOf(s: WaitSettings) {
  return {
    showOnTicket: s.showOnTicket,
    showAsRange: s.showAsRange,
    minShown: s.minShown,
    label: s.label,
    unitLabel: s.unitLabel,
    nextText: s.nextText,
    disclaimer: s.disclaimer,
  };
}
