/**
 * Optional: fills the demo organization with a synthetic past (tickets, events and agent shifts) so reports,
 * heatmaps and the forecast have something to show. Opt-in, never part of the normal seed.
 *
 *   npm run db:history               # 14 days before today
 *   npm run db:history -- --days 30
 *   npm run db:history -- --purge    # removes exactly what this script created
 *
 * Every ticket it creates has source = "demo_history"; --purge deletes those and the agent shifts before today.
 */
import "dotenv/config";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { randomToken } from "@/server/crypto";
import { logger } from "@/server/logger";
import { formatTicketNumber } from "@/domain/i18n/digits";
import { serviceDay, zonedToUtc } from "@/domain/schedule/time";
import { db, pool } from "../client";
import * as s from "../schema";

const SOURCE = "demo_history";
const MIN = 60_000;

/** Small deterministic PRNG so two runs produce the same history. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Busy mid-morning, a lunch dip and a smaller afternoon peak (share of the day's visitors per hour). */
const HOURLY = [0, 0, 0, 0, 0, 0, 0, 0, 0.08, 0.13, 0.15, 0.13, 0.07, 0.1, 0.13, 0.11, 0.06, 0.04, 0, 0, 0, 0, 0, 0];

async function purge(orgId: string) {
  const { rowCount } = await db().execute(sql`
    with gone as (select id from tickets where organization_id = ${orgId} and source = ${SOURCE}),
    e as (delete from ticket_events where ticket_id in (select id from gone))
    delete from tickets where id in (select id from gone)`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await db()
    .delete(s.agentStatusLog)
    .where(and(eq(s.agentStatusLog.organizationId, orgId), lt(s.agentStatusLog.at, today)));
  logger.info({ tickets: rowCount }, "demo history removed");
}

async function main() {
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg > 0 ? Math.max(1, Math.min(90, Number(process.argv[daysArg + 1]) || 14)) : 14;
  const [org] = await db().select().from(s.organizations).limit(1);
  if (!org) throw new Error("no organization; run npm run db:seed first");
  if (process.argv.includes("--purge")) return purge(org.id);

  const [branch] = await db()
    .select()
    .from(s.branches)
    .where(and(eq(s.branches.organizationId, org.id), isNull(s.branches.archivedAt)));
  const tz = branch.timezone;
  const reasons = await db()
    .select()
    .from(s.visitReasons)
    .where(and(eq(s.visitReasons.organizationId, org.id), isNull(s.visitReasons.archivedAt)));
  const queues = await db().select().from(s.queues).where(eq(s.queues.branchId, branch.id));
  const profiles = await db().select().from(s.agentProfiles).where(eq(s.agentProfiles.branchId, branch.id));
  const deskRows = await db().select().from(s.desks).where(eq(s.desks.branchId, branch.id));
  if (!reasons.length || !profiles.length) throw new Error("the demo organization needs reasons and agents");
  const ticketing = await db()
    .select()
    .from(s.settings)
    .where(and(eq(s.settings.organizationId, org.id), eq(s.settings.key, "ticketing")));
  const pad = (ticketing[0]?.value as { numberPad?: number } | undefined)?.numberPad ?? 3;
  const separator = (ticketing[0]?.value as { separator?: string } | undefined)?.separator ?? "-";
  const queueOf = new Map(queues.map((q) => [q.reasonId, q]));

  // Weights so "general inquiry" dominates and complaints are rare.
  const weights = reasons.map((_, i) => [5, 3, 1.5, 2.5, 1][i] ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const now = Date.now();
  const todayLocal = serviceDay(now, tz, "00:00");
  let created = 0;

  for (let back = days; back >= 1; back--) {
    const d = new Date(`${todayLocal}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    if (branch.weekend.includes(weekday)) continue;
    const random = rng(Number(date.replace(/-/g, "")));
    const pick = <T>(xs: T[], w?: number[]) => {
      if (!w) return xs[Math.floor(random() * xs.length)];
      let r = random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < xs.length; i++) if ((r -= w[i]) < 0) return xs[i];
      return xs[xs.length - 1];
    };
    const volume = Math.round(55 + random() * 30 + (weekday === 0 || weekday === 1 ? 12 : 0));

    // Arrivals following the hourly profile.
    const arrivals: number[] = [];
    for (let i = 0; i < volume; i++) {
      const hour = pick(
        [...HOURLY.keys()],
        HOURLY.map((x) => x + 0.0001),
      );
      arrivals.push(zonedToUtc(date, "00:00", tz) + hour * 60 * MIN + Math.floor(random() * 60 * MIN));
    }
    arrivals.sort((a, b) => a - b);

    // Agents work 08:00-16:00 with a lunch break; each is free from their start.
    const shifts = profiles.map((p, i) => {
      const start = zonedToUtc(date, "08:00", tz) + Math.floor(random() * 12) * MIN;
      const end = zonedToUtc(date, "16:00", tz) + Math.floor(random() * 20) * MIN;
      const lunchStart = zonedToUtc(date, "12:00", tz) + (i % 3) * 20 * MIN;
      return {
        p,
        free: start,
        start,
        end,
        lunchStart,
        lunchEnd: lunchStart + 30 * MIN,
        desk: deskRows[i % Math.max(1, deskRows.length)],
      };
    });

    const counters = new Map<string, number>();
    const ticketRows: (typeof s.tickets.$inferInsert)[] = [];
    const eventRows: (typeof s.ticketEvents.$inferInsert)[] = [];
    const lastFinish = new Map<string, number>();

    for (const arrivedAt of arrivals) {
      const reason = pick(
        reasons,
        weights.slice(0, reasons.length).map((w) => w / totalWeight),
      );
      const queue = queueOf.get(reason.id);
      if (!queue) continue;
      const prefix = queue.prefix ?? reason.prefix;
      const number = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, number);

      // Earliest agent who is on shift and not at lunch.
      const usable = shifts
        .map((sh) => {
          let at = Math.max(sh.free, arrivedAt, sh.start);
          if (at >= sh.lunchStart && at < sh.lunchEnd) at = sh.lunchEnd;
          return { sh, at };
        })
        .filter((x) => x.at < x.sh.end)
        .sort((a, b) => a.at - b.at);
      const id = crypto.randomUUID();
      const base = {
        id,
        organizationId: org.id,
        branchId: branch.id,
        queueId: queue.id,
        reasonId: reason.id,
        prefix,
        number,
        displayNumber: formatTicketNumber(prefix, number, { pad, separator }),
        serviceDay: date,
        language: random() < 0.85 ? "ar" : "en",
        publicToken: randomToken(),
        arrivedAt: new Date(arrivedAt),
        queuedAt: new Date(arrivedAt),
        source: SOURCE,
        createdAt: new Date(arrivedAt),
      } satisfies Partial<typeof s.tickets.$inferInsert>;
      const ev = (type: string, at: number, extra: Partial<typeof s.ticketEvents.$inferInsert> = {}) =>
        eventRows.push({
          organizationId: org.id,
          branchId: branch.id,
          ticketId: id,
          type,
          queueId: queue.id,
          at: new Date(at),
          ...extra,
        });
      ev("ISSUED", arrivedAt, { toStatus: "WAITING", actorType: "system" });

      const chosen = usable[0];
      if (!chosen || random() < 0.03) {
        // Nobody free before closing, or the visitor left before anyone was available.
        const leftAt = arrivedAt + Math.floor((4 + random() * 10) * MIN);
        ticketRows.push({ ...base, status: "CANCELLED", finishedAt: new Date(leftAt), updatedAt: new Date(leftAt) });
        ev("CANCELLED", leftAt, { fromStatus: "WAITING", toStatus: "CANCELLED" });
        continue;
      }
      const callAt = chosen.at;
      const wait = (callAt - arrivedAt) / MIN;
      if (wait > 10 && random() < 0.12) {
        const leftAt = arrivedAt + Math.floor((wait * 0.6 + random() * 3) * MIN);
        ticketRows.push({ ...base, status: "CANCELLED", finishedAt: new Date(leftAt), updatedAt: new Date(leftAt) });
        ev("CANCELLED", leftAt, { fromStatus: "WAITING", toStatus: "CANCELLED" });
        continue;
      }
      const agentId = chosen.sh.p.userId;
      const deskId = chosen.sh.desk?.id ?? null;
      ev("CALLED", callAt, { fromStatus: "WAITING", toStatus: "CALLED", agentId, deskId });

      if (random() < 0.06) {
        const recalls = 1 + Math.floor(random() * 2);
        for (let r = 1; r <= recalls; r++) ev("RECALLED", callAt + r * 90_000, { agentId, deskId });
        const doneAt = callAt + (recalls + 1) * 90_000;
        ticketRows.push({
          ...base,
          status: "NO_SHOW",
          servingAgentId: agentId,
          deskId,
          calledAt: new Date(callAt),
          recallCount: recalls,
          finishedAt: new Date(doneAt),
          updatedAt: new Date(doneAt),
        });
        ev("NO_SHOW", doneAt, { fromStatus: "CALLED", toStatus: "NO_SHOW", agentId, deskId });
        chosen.sh.free = doneAt;
        continue;
      }

      const mean = reason.expectedServiceMinutes;
      const svc = Math.max(2, mean * (0.5 + random() * 1.1) + (random() < 0.1 ? mean : 0));
      const startAt = callAt + Math.floor((0.3 + random() * 0.7) * MIN);
      const doneAt = startAt + Math.floor(svc * MIN);
      const recalled = random() < 0.08;
      if (recalled) ev("RECALLED", callAt + 60_000, { agentId, deskId });
      ev("STARTED", startAt, { fromStatus: "CALLED", toStatus: "SERVING", agentId, deskId });
      if (random() < 0.05) {
        const other = shifts.find((x) => x.p.userId !== agentId)?.p.userId;
        ev("TRANSFERRED", startAt + 30_000, {
          agentId: other ?? agentId,
          actorUserId: other ?? agentId,
          fromStatus: "SERVING",
          toStatus: "WAITING",
        });
      }
      ev("COMPLETED", doneAt, { fromStatus: "SERVING", toStatus: "COMPLETED", agentId, deskId });
      ticketRows.push({
        ...base,
        status: "COMPLETED",
        servingAgentId: agentId,
        deskId,
        calledAt: new Date(callAt),
        recallCount: recalled ? 1 : 0,
        startedAt: new Date(startAt),
        finishedAt: new Date(doneAt),
        outcome: "done",
        updatedAt: new Date(doneAt),
      });
      chosen.sh.free = doneAt;
      lastFinish.set(agentId, Math.max(lastFinish.get(agentId) ?? 0, doneAt));
    }

    await db().transaction(async (tx) => {
      const chunk = <T>(xs: T[], n = 500) =>
        Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
      for (const c of chunk(ticketRows)) await tx.insert(s.tickets).values(c);
      for (const c of chunk(eventRows)) await tx.insert(s.ticketEvents).values(c);
      for (const [prefix, lastNumber] of counters) {
        await tx
          .insert(s.ticketCounters)
          .values({ branchId: branch.id, prefix, serviceDay: date, lastNumber })
          .onConflictDoUpdate({
            target: [s.ticketCounters.branchId, s.ticketCounters.prefix, s.ticketCounters.serviceDay],
            set: { lastNumber },
          });
      }
      const log: (typeof s.agentStatusLog.$inferInsert)[] = [];
      for (const sh of shifts) {
        const userId = sh.p.userId;
        const common = { organizationId: org.id, branchId: branch.id, userId, deskId: sh.desk?.id ?? null };
        const off = Math.max(sh.end, lastFinish.get(userId) ?? 0);
        log.push(
          { ...common, status: "AVAILABLE", at: new Date(sh.start) },
          { ...common, status: "ON_BREAK", at: new Date(sh.lunchStart) },
          { ...common, status: "AVAILABLE", at: new Date(sh.lunchEnd) },
          { ...common, status: "OFFLINE", at: new Date(off) },
        );
      }
      await tx.insert(s.agentStatusLog).values(log);
    });
    created += ticketRows.length;
    logger.info({ date, tickets: ticketRows.length }, "day created");
  }
  logger.info({ created, days }, "demo history created");
}

main()
  .catch((err) => {
    logger.fatal({ err }, "history seed failed");
    process.exitCode = 1;
  })
  .finally(() => pool().end());
