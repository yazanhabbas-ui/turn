import { averageScore, satisfiedPct, summarizeCsat, type FeedbackFact } from "../feedback/csat";
import { zonedParts } from "../schedule/time";
import { minuteInShift } from "../shifts/window";
import type {
  AgentReport,
  CsatGroup,
  CsatReport,
  Forecast,
  ReasonReport,
  RepeatReport,
  ReportData,
  ReportInput,
  ShiftReport,
  Spread,
  TicketFact,
} from "./types";

const MIN = 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0);

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Linear-interpolated percentile (p in 0..100) of an unsorted list. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

function spread(xs: number[]): Spread {
  return {
    avg: round1(mean(xs)),
    median: round1(percentile(xs, 50)),
    p90: round1(percentile(xs, 90)),
    max: round1(xs.length ? Math.max(...xs) : 0),
  };
}

/** Jain's fairness index: 1 = everyone did the same amount of work, 1/n = one person did everything. */
export function fairnessIndex(loads: number[]): number {
  const n = loads.length;
  const sum = loads.reduce((a, b) => a + b, 0);
  const sq = loads.reduce((a, b) => a + b * b, 0);
  if (n === 0 || sq === 0) return 1;
  return Math.round(((sum * sum) / (n * sq)) * 1000) / 1000;
}

const isOpen = (f: TicketFact) => ["WAITING", "CALLED", "SERVING", "ON_HOLD", "APPOINTMENT_PENDING"].includes(f.status);
const waitOf = (f: TicketFact) => (f.firstCalledAt === null ? null : Math.max(0, f.firstCalledAt - f.arrivedAt) / MIN);
const serviceOf = (f: TicketFact) =>
  f.status === "COMPLETED" && f.startedAt !== null && f.finishedAt !== null
    ? Math.max(0, f.finishedAt - f.startedAt) / MIN
    : null;

/** When a visitor gave up: the moment they cancelled, or the call they did not answer. */
function abandonWaitMin(f: TicketFact): number | null {
  if (f.status === "CANCELLED") return f.finishedAt === null ? null : Math.max(0, f.finishedAt - f.arrivedAt) / MIN;
  if (f.status === "NO_SHOW") {
    const at = f.firstCalledAt ?? f.finishedAt;
    return at === null ? null : Math.max(0, at - f.arrivedAt) / MIN;
  }
  return null;
}

/** Time an agent spent in each state inside [fromMs, toMs), from the status log. */
export function agentTimes(
  log: { status: string; at: number }[],
  fromMs: number,
  toMs: number,
  now: number,
): { loginMin: number; breakMin: number; availableMin: number } {
  const end = Math.min(toMs, now);
  const sorted = [...log].sort((a, b) => a.at - b.at);
  let state = "OFFLINE";
  let cursor = fromMs;
  const acc: Record<string, number> = {};
  const add = (until: number) => {
    const to = Math.min(until, end);
    if (to > cursor) acc[state] = (acc[state] ?? 0) + (to - cursor);
    cursor = Math.max(cursor, to);
  };
  for (const e of sorted) {
    if (e.at <= fromMs) {
      state = e.status;
      continue;
    }
    if (e.at >= end) break;
    add(e.at);
    state = e.status;
    cursor = Math.max(cursor, e.at);
  }
  add(end);
  const ms = (s: string) => acc[s] ?? 0;
  const login = ms("AVAILABLE") + ms("BUSY") + ms("ON_BREAK") + ms("AWAY");
  return { loginMin: login / MIN, breakMin: ms("ON_BREAK") / MIN, availableMin: (ms("AVAILABLE") + ms("BUSY")) / MIN };
}

/** Sweep-line: how many tickets were waiting at each 15-minute mark, summarised by hour of day. */
function queueLength(facts: TicketFact[], tzOf: (branchId: string) => string, fromMs: number, toMs: number, now: number) {
  const step = 15 * MIN;
  const perBranch = new Map<string, TicketFact[]>();
  for (const f of facts) perBranch.set(f.branchId, [...(perBranch.get(f.branchId) ?? []), f]);
  const sum = new Array(24).fill(0);
  const cnt = new Array(24).fill(0);
  const max = new Array(24).fill(0);
  const end = Math.min(toMs, now);
  for (const [branchId, list] of perBranch) {
    const tz = tzOf(branchId);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const f of list) {
      const leftAt = f.firstCalledAt ?? (f.status === "CANCELLED" ? f.finishedAt : null) ?? (isOpen(f) ? Infinity : f.finishedAt);
      if (leftAt === null) continue;
      starts.push(f.arrivedAt);
      ends.push(leftAt);
    }
    starts.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    let si = 0;
    let ei = 0;
    for (let t = fromMs; t < end; t += step) {
      while (si < starts.length && starts[si] <= t) si++;
      while (ei < ends.length && ends[ei] <= t) ei++;
      const waiting = si - ei;
      const hour = Math.floor(zonedParts(t, tz).minutes / 60);
      sum[hour] += waiting;
      cnt[hour]++;
      max[hour] = Math.max(max[hour], waiting);
    }
  }
  return sum.map((s, hour) => ({ hour, avg: cnt[hour] ? round1(s / cnt[hour]) : 0, max: max[hour] }));
}

function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = d.getUTCDay(); // weeks start on Sunday, matching the regional weekend setting default
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** How many times each identified visitor came, who came back most, and how the visits are spread. */
export function repeatVisitors(facts: TicketFact[]): RepeatReport {
  const byVisitor = new Map<string, TicketFact[]>();
  let anonymous = 0;
  for (const f of facts) {
    if (!f.visitorId) anonymous++;
    else byVisitor.set(f.visitorId, [...(byVisitor.get(f.visitorId) ?? []), f]);
  }
  const buckets = new Map<number, number>();
  const rows = [...byVisitor].map(([visitorId, list]) => {
    const times = list.map((f) => f.arrivedAt).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86_400_000);
    buckets.set(Math.min(5, list.length), (buckets.get(Math.min(5, list.length)) ?? 0) + 1);
    return {
      visitorId,
      visits: list.length,
      firstAt: times[0],
      lastAt: times[times.length - 1],
      avgDaysBetween: round1(mean(gaps)),
      reasonIds: [...new Set(list.map((f) => f.reasonId))],
    };
  });
  const repeaters = rows.filter((r) => r.visits >= 2);
  return {
    uniqueVisitors: rows.length,
    identifiedTickets: facts.length - anonymous,
    anonymousTickets: anonymous,
    repeatVisitors: repeaters.length,
    repeatRatePct: pct(repeaters.length, rows.length),
    avgVisits: rows.length ? round1((facts.length - anonymous) / rows.length) : 0,
    distribution: [1, 2, 3, 4, 5].map((visits) => ({ visits, visitors: buckets.get(visits) ?? 0 })),
    top: repeaters.sort((a, b) => b.visits - a.visits || b.lastAt - a.lastAt).slice(0, 100),
  };
}

/** Satisfaction of the answers whose ticket is in the period, overall and by agent, reason, branch, shift and day. */
export function computeCsat(input: ReportInput, shiftOf: (f: TicketFact) => string | null): CsatReport {
  const byTicket = new Map(input.facts.map((f) => [f.id, f]));
  const answers = (input.feedback ?? [])
    .map((fb) => ({ fb, t: byTicket.get(fb.ticketId) }))
    .filter((x): x is { fb: FeedbackFact; t: TicketFact } => !!x.t);
  const eligible = input.facts.filter((f) => f.status === "COMPLETED").length;
  const group = (
    keyOf: (t: TicketFact) => string | null,
    nameOf: (key: string | null) => Record<string, string>,
  ): CsatGroup[] => {
    const map = new Map<string | null, number[]>();
    for (const { fb, t } of answers) {
      const key = keyOf(t);
      map.set(key, [...(map.get(key) ?? []), fb.score]);
    }
    return [...map]
      .map(([key, scores]) => ({
        key,
        name: nameOf(key),
        responses: scores.length,
        avg: averageScore(scores),
        satisfiedPct: satisfiedPct(scores),
      }))
      .sort((a, b) => b.responses - a.responses);
  };
  const days = new Map<string, number[]>();
  for (const { fb, t } of answers) {
    const date = zonedParts(t.arrivedAt, input.branches.get(t.branchId)?.timezone ?? "Asia/Damascus").date;
    days.set(date, [...(days.get(date) ?? []), fb.score]);
  }
  const threshold = input.lowScoreThreshold ?? 2;
  return {
    summary: summarizeCsat(
      answers.map((x) => x.fb),
      eligible,
    ),
    byDay: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, scores]) => ({ date, responses: scores.length, avg: averageScore(scores) })),
    byAgent: group(
      (t) => t.agentId,
      (k) => (k ? (input.agents.get(k)?.name ?? {}) : {}),
    ),
    byReason: group(
      (t) => t.reasonId,
      (k) => (k ? (input.reasons.get(k)?.name ?? {}) : {}),
    ),
    byBranch: group(
      (t) => t.branchId,
      (k) => (k ? (input.branches.get(k)?.name ?? {}) : {}),
    ),
    byShift: input.shifts?.length ? group(shiftOf, (k) => input.shifts?.find((x) => x.id === k)?.name ?? {}) : [],
    lowComments: answers
      .filter((x) => x.fb.score <= threshold && x.fb.comment)
      .sort((a, b) => b.fb.at - a.fb.at)
      .slice(0, 50)
      .map(({ fb, t }) => ({
        id: fb.id,
        at: fb.at,
        score: fb.score,
        comment: fb.comment!,
        displayNumber: fb.displayNumber ?? "",
        branchId: t.branchId,
        reasonId: t.reasonId,
        agentId: t.agentId,
        visitorId: t.visitorId,
      })),
  };
}

export function computeReport(input: ReportInput): ReportData {
  const { facts, fromMs, toMs, now } = input;
  const tzOf = (branchId: string) => input.branches.get(branchId)?.timezone ?? "Asia/Damascus";
  const local = new Map<string, ReturnType<typeof zonedParts>>();
  const partsOf = (f: TicketFact) => {
    let p = local.get(f.id);
    if (!p) local.set(f.id, (p = zonedParts(f.arrivedAt, tzOf(f.branchId))));
    return p;
  };

  const served = facts.filter((f) => f.status === "COMPLETED");
  const noShow = facts.filter((f) => f.status === "NO_SHOW");
  const cancelled = facts.filter((f) => f.status === "CANCELLED");
  const called = facts.filter((f) => f.firstCalledAt !== null);
  const waits = called.map((f) => waitOf(f)!);
  const services = served.map(serviceOf).filter((x): x is number => x !== null);
  const abandons = [...noShow, ...cancelled].map(abandonWaitMin).filter((x): x is number => x !== null);
  const withinSla = called.filter((f) => waitOf(f)! <= f.slaTargetMinutes).length;
  const withinLevel = called.filter((f) => waitOf(f)! <= input.serviceLevel.minutes).length;

  // Agent time and workload.
  const logByAgent = new Map<string, { status: string; at: number }[]>();
  for (const e of input.statusLog) logByAgent.set(e.userId, [...(logByAgent.get(e.userId) ?? []), e]);
  const agentIds = new Set<string>([...logByAgent.keys(), ...facts.map((f) => f.agentId).filter((x): x is string => !!x)]);
  for (const f of facts) for (const a of f.transfersOut) agentIds.add(a);
  const end = Math.min(toMs, now);
  const agents: AgentReport[] = [...agentIds].map((agentId) => {
    const mine = facts.filter((f) => f.agentId === agentId);
    const doneMine = mine.filter((f) => f.status === "COMPLETED");
    const svc = doneMine.map(serviceOf).filter((x): x is number => x !== null);
    // Serving time counts every ticket the agent handled, clipped to the range (a ticket still open counts up to now).
    let servingMs = 0;
    for (const f of mine) {
      if (f.startedAt === null) continue;
      const s = Math.max(f.startedAt, fromMs);
      const e = Math.min(f.finishedAt ?? end, end);
      if (e > s) servingMs += e - s;
    }
    const t = agentTimes(logByAgent.get(agentId) ?? [], fromMs, toMs, now);
    const servingMin = servingMs / MIN;
    const working = Math.max(0, t.loginMin - t.breakMin);
    return {
      agentId,
      name: input.agents.get(agentId)?.name ?? {},
      shiftId: input.agentShift?.get(agentId) ?? null,
      served: doneMine.length,
      noShow: mine.filter((f) => f.status === "NO_SHOW").length,
      transferOut: facts.reduce((n, f) => n + f.transfersOut.filter((a) => a === agentId).length, 0),
      transferIn: mine.filter((f) => f.transfersOut.length > 0).length,
      avgServiceMin: round1(mean(svc)),
      medianServiceMin: round1(percentile(svc, 50)),
      p90ServiceMin: round1(percentile(svc, 90)),
      loginMin: round1(t.loginMin),
      breakMin: round1(t.breakMin),
      availableMin: round1(t.availableMin),
      servingMin: round1(servingMin),
      idleMin: round1(Math.max(0, t.availableMin - servingMin)),
      utilisationPct: working > 0 ? Math.min(100, pct(servingMin, working)) : 0,
      csatAvg: null,
      csatResponses: 0,
    };
  });
  const scoresOf = new Map<string, number[]>();
  {
    const byTicket = new Map(facts.map((f) => [f.id, f]));
    for (const fb of input.feedback ?? []) {
      const agentId = byTicket.get(fb.ticketId)?.agentId;
      if (agentId) scoresOf.set(agentId, [...(scoresOf.get(agentId) ?? []), fb.score]);
    }
  }
  for (const a of agents) {
    const sc = scoresOf.get(a.agentId) ?? [];
    a.csatAvg = averageScore(sc);
    a.csatResponses = sc.length;
  }
  agents.sort((a, b) => b.served - a.served);

  // Per reason.
  const reasonIds = [...new Set(facts.map((f) => f.reasonId))];
  const byReason: ReasonReport[] = reasonIds
    .map((reasonId) => {
      const list = facts.filter((f) => f.reasonId === reasonId);
      const c = list.filter((f) => f.firstCalledAt !== null);
      const w = c.map((f) => waitOf(f)!);
      const s = list.map(serviceOf).filter((x): x is number => x !== null);
      return {
        reasonId,
        name: input.reasons.get(reasonId)?.name ?? {},
        color: input.reasons.get(reasonId)?.color ?? "#888888",
        visitors: list.length,
        served: list.filter((f) => f.status === "COMPLETED").length,
        avgWaitMin: round1(mean(w)),
        p90WaitMin: round1(percentile(w, 90)),
        avgServiceMin: round1(mean(s)),
        p90ServiceMin: round1(percentile(s, 90)),
        slaPct: pct(c.filter((f) => waitOf(f)! <= f.slaTargetMinutes).length, c.length),
      };
    })
    .sort((a, b) => b.visitors - a.visitors);

  // Time buckets in each branch's own time zone.
  const dayMap = new Map<string, TicketFact[]>();
  const hourMap: TicketFact[][] = Array.from({ length: 24 }, () => []);
  const weekdayCount = new Array(7).fill(0);
  const heat = new Map<string, number>();
  for (const f of facts) {
    const p = partsOf(f);
    dayMap.set(p.date, [...(dayMap.get(p.date) ?? []), f]);
    const hour = Math.floor(p.minutes / 60);
    hourMap[hour].push(f);
    weekdayCount[p.weekday]++;
    heat.set(`${p.weekday}:${hour}`, (heat.get(`${p.weekday}:${hour}`) ?? 0) + 1);
  }
  const avgWaitOf = (list: TicketFact[]) => round1(mean(list.filter((f) => f.firstCalledAt !== null).map((f) => waitOf(f)!)));
  const cells = [...heat].map(
    ([k, count]) => [Number(k.split(":")[0]), Number(k.split(":")[1]), count] as [number, number, number],
  );

  // Per branch.
  const byBranch = [...new Set(facts.map((f) => f.branchId))].map((branchId) => {
    const list = facts.filter((f) => f.branchId === branchId);
    return {
      branchId,
      name: input.branches.get(branchId)?.name ?? {},
      visitors: list.length,
      served: list.filter((f) => f.status === "COMPLETED").length,
      avgWaitMin: avgWaitOf(list),
    };
  });

  // Weekly reason mix.
  const weeks = new Map<string, Record<string, number>>();
  for (const f of facts) {
    const w = weekStartOf(partsOf(f).date);
    const row = weeks.get(w) ?? {};
    row[f.reasonId] = (row[f.reasonId] ?? 0) + 1;
    weeks.set(w, row);
  }

  // By shift: a visitor belongs to the first shift whose hours contain their arrival time.
  const shiftRows: ShiftReport[] = [];
  if (input.shifts?.length) {
    const bucket = new Map<string | null, TicketFact[]>();
    for (const f of facts) {
      const minute = partsOf(f).minutes;
      const sh = input.shifts.find((x) => minuteInShift(x, minute));
      bucket.set(sh?.id ?? null, [...(bucket.get(sh?.id ?? null) ?? []), f]);
    }
    for (const sh of input.shifts) {
      const list = bucket.get(sh.id) ?? [];
      shiftRows.push({
        shiftId: sh.id,
        name: sh.name,
        visitors: list.length,
        served: list.filter((f) => f.status === "COMPLETED").length,
        avgWaitMin: avgWaitOf(list),
      });
    }
    const outside = bucket.get(null) ?? [];
    if (outside.length)
      shiftRows.push({
        shiftId: null,
        name: {},
        visitors: outside.length,
        served: outside.filter((f) => f.status === "COMPLETED").length,
        avgWaitMin: avgWaitOf(outside),
      });
  }

  const workers = agents.filter((a) => a.loginMin > 0 || a.served > 0);
  return {
    range: { fromMs, toMs },
    summary: {
      visitors: facts.length,
      served: served.length,
      noShow: noShow.length,
      cancelled: cancelled.length,
      transferred: facts.filter((f) => f.transfersOut.length > 0).length,
      stillOpen: facts.filter(isOpen).length,
      wait: spread(waits),
      service: spread(services),
      slaPct: pct(withinSla, called.length),
      serviceLevel: {
        minutes: input.serviceLevel.minutes,
        targetPct: input.serviceLevel.targetPct,
        pct: pct(withinLevel, called.length),
      },
      abandonmentPct: pct(noShow.length + cancelled.length, facts.length),
      avgWaitBeforeAbandonMin: round1(mean(abandons)),
      recallRatePct: pct(called.filter((f) => f.recalls > 0).length, called.length),
      transferRatePct: pct(facts.filter((f) => f.transfersOut.length > 0).length, facts.length),
      returningPct: pct(facts.filter((f) => f.returning).length, facts.length),
      firstVisitPct: facts.length ? round1(100 - pct(facts.filter((f) => f.returning).length, facts.length)) : 0,
      fairnessIndex: fairnessIndex(workers.map((a) => a.served)),
    },
    byDay: [...dayMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({
        date,
        visitors: list.length,
        served: list.filter((f) => f.status === "COMPLETED").length,
        avgWaitMin: avgWaitOf(list),
      })),
    byHour: hourMap.map((list, hour) => ({
      hour,
      visitors: list.length,
      served: list.filter((f) => f.status === "COMPLETED").length,
      avgWaitMin: avgWaitOf(list),
    })),
    byWeekday: weekdayCount.map((visitors, weekday) => ({ weekday, visitors })),
    byBranch,
    byReason,
    byShift: shiftRows,
    repeat: repeatVisitors(facts),
    csat: computeCsat(input, (f) => input.shifts?.find((x) => minuteInShift(x, partsOf(f).minutes))?.id ?? null),
    heatmap: { cells, max: cells.reduce((m, c) => Math.max(m, c[2]), 0) },
    agents,
    queueLengthByHour: queueLength(facts, tzOf, fromMs, toMs, now),
    backlogByDay: [...dayMap]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, count: list.filter(isOpen).length })),
    reasonMixWeekly: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, counts]) => ({ weekStart, counts })),
  };
}

/**
 * Expected volume from recent history: the mean of the same weekday over the days available (up to the window),
 * by day for the next week and by hour for tomorrow, plus the agents needed to keep up at the target utilisation.
 */
export function computeForecast(input: {
  /** Arrival time and branch of each ticket over the history window. */
  arrivals: { at: number; branchId: string }[];
  timezone: string;
  /** Days of history that were actually observed (so empty days count as zero). */
  historyDays: string[];
  today: string;
  avgServiceMin: number;
  targetUtilisationPct: number;
}): Forecast {
  const { timezone: tz } = input;
  const byDate = new Map<string, number[]>();
  for (const d of input.historyDays) byDate.set(d, new Array(24).fill(0));
  for (const a of input.arrivals) {
    const p = zonedParts(a.at, tz);
    const row = byDate.get(p.date);
    if (row) row[Math.floor(p.minutes / 60)]++;
  }
  const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const perWeekday = new Map<number, number[][]>();
  const all: number[][] = [];
  for (const [date, hours] of byDate) {
    all.push(hours);
    perWeekday.set(weekdayOf(date), [...(perWeekday.get(weekdayOf(date)) ?? []), hours]);
  }
  const expectedHours = (weekday: number): number[] => {
    const rows = perWeekday.get(weekday) ?? all;
    if (!rows.length) return new Array(24).fill(0);
    return Array.from({ length: 24 }, (_, h) => mean(rows.map((r) => r[h])));
  };
  const addDays = (date: string, n: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(input.today, i + 1);
    const weekday = weekdayOf(date);
    return { date, weekday, expected: Math.round(expectedHours(weekday).reduce((a, b) => a + b, 0)) };
  });
  const tomorrow = addDays(input.today, 1);
  const util = Math.max(0.1, input.targetUtilisationPct / 100);
  const hours = expectedHours(weekdayOf(tomorrow)).map((e, hour) => ({
    hour,
    expected: round1(e),
    // Work arriving in the hour (minutes of service) divided by the minutes one agent can usefully give.
    agentsNeeded: e > 0 ? Math.max(1, Math.ceil((e * input.avgServiceMin) / (60 * util))) : 0,
  }));
  return {
    basedOnDays: input.historyDays.length,
    days,
    tomorrow: { date: tomorrow, hours },
    avgServiceMin: round1(input.avgServiceMin),
    targetUtilisationPct: input.targetUtilisationPct,
  };
}
