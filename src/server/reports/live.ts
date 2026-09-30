import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { serviceDay } from "@/domain/schedule/time";
import { agentProfiles, alerts, desks, tickets, users, visitReasons } from "@/db/schema";
import type { Actor } from "../admin/actor";
import { now as clockNow } from "../clock";
import { getSetting } from "../settings/service";
import { orgOf } from "../admin/actor";
import { reportBranches } from "./service";

const MIN = 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The live operations view (wallboard): real-time tiles, per-desk status and long-wait warnings.
 * Contains ticket numbers and counts only, no visitor details.
 */
export async function liveView(actor: Actor, branchId?: string) {
  const [branch] = await reportBranches(actor, "wallboard.view", branchId);
  const org = orgOf(actor);
  const now = clockNow();
  const settings = await getSetting(org, "alerts", branch.id);
  const [branding, wallboard] = await Promise.all([
    getSetting(org, "branding", branch.id),
    getSetting(org, "wallboard", branch.id),
  ]);
  const day = serviceDay(now, branch.timezone, (await getSetting(org, "ticketing", branch.id)).dailyResetTime);

  const [open, profiles, deskRows, reasonRows, openAlerts] = await Promise.all([
    db()
      .select({
        id: tickets.id,
        displayNumber: tickets.displayNumber,
        status: tickets.status,
        reasonId: tickets.reasonId,
        arrivedAt: tickets.arrivedAt,
        queuedAt: tickets.queuedAt,
        calledAt: tickets.calledAt,
        startedAt: tickets.startedAt,
        servingAgentId: tickets.servingAgentId,
        deskId: tickets.deskId,
        serviceDay: tickets.serviceDay,
      })
      .from(tickets)
      // Today's tickets plus anything still open from an earlier day (nobody is lost across the daily reset).
      .where(
        and(
          eq(tickets.branchId, branch.id),
          or(eq(tickets.serviceDay, day), inArray(tickets.status, ["WAITING", "CALLED", "SERVING", "ON_HOLD"])),
        ),
      ),
    db().select().from(agentProfiles).where(eq(agentProfiles.branchId, branch.id)),
    db()
      .select()
      .from(desks)
      .where(and(eq(desks.branchId, branch.id), isNull(desks.archivedAt)))
      .orderBy(asc(desks.sortOrder), asc(desks.number)),
    db().select().from(visitReasons).where(eq(visitReasons.organizationId, org)).orderBy(asc(visitReasons.sortOrder)),
    db()
      .select()
      .from(alerts)
      .where(and(eq(alerts.organizationId, org), eq(alerts.branchId, branch.id), isNull(alerts.acknowledgedAt)))
      .orderBy(asc(alerts.createdAt)),
  ]);

  const names = new Map(
    (await db().select({ id: users.id, name: users.displayName }).from(users).where(eq(users.organizationId, org))).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const reasonById = new Map(reasonRows.map((r) => [r.id, r]));
  const waiting = open.filter((t) => t.status === "WAITING");
  const waitMin = (t: (typeof open)[number]) => (now - t.arrivedAt.getTime()) / MIN;

  const todays = open.filter((t) => t.serviceDay === day);
  const done = todays.filter((t) => t.status === "COMPLETED");
  const calledToday = todays.filter((t) => t.calledAt);
  const waitsToday = calledToday.map((t) => (t.calledAt!.getTime() - t.arrivedAt.getTime()) / MIN);
  const within = calledToday.filter(
    (t) => (t.calledAt!.getTime() - t.arrivedAt.getTime()) / MIN <= (reasonById.get(t.reasonId)?.slaTargetWaitMinutes ?? 15),
  ).length;

  const byStatus = (s: string) => profiles.filter((p) => p.status === s).length;
  // An agent may have several visitors at once: keep them all, oldest first.
  const activeByAgent = new Map<string | null, typeof open>();
  for (const t of open
    .filter((x) => x.status === "CALLED" || x.status === "SERVING")
    .sort((a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime())) {
    activeByAgent.set(t.servingAgentId, [...(activeByAgent.get(t.servingAgentId) ?? []), t]);
  }

  return {
    now: new Date(now).toISOString(),
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    branding: {
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
    },
    wallboard,
    tiles: {
      waiting: waiting.length,
      longestWaitMin: round1(waiting.length ? Math.max(...waiting.map(waitMin)) : 0),
      called: open.filter((t) => t.status === "CALLED").length,
      serving: open.filter((t) => t.status === "SERVING").length,
      onHold: open.filter((t) => t.status === "ON_HOLD").length,
      agentsAvailable: byStatus("AVAILABLE"),
      agentsBusy: byStatus("BUSY"),
      agentsOnBreak: byStatus("ON_BREAK"),
      agentsOffline: byStatus("OFFLINE") + byStatus("AWAY"),
      servedToday: done.length,
      noShowToday: todays.filter((t) => t.status === "NO_SHOW").length,
      avgWaitTodayMin: round1(waitsToday.length ? waitsToday.reduce((a, b) => a + b, 0) / waitsToday.length : 0),
      slaTodayPct: calledToday.length ? round1((within / calledToday.length) * 100) : 0,
      visitorsToday: todays.length,
    },
    desks: deskRows.map((d) => {
      const agent = profiles.find((p) => p.currentDeskId === d.id && p.status !== "OFFLINE");
      const mine = agent ? (activeByAgent.get(agent.userId) ?? []) : [];
      const list = mine.map((t) => ({
        displayNumber: t.displayNumber,
        status: t.status,
        reasonId: t.reasonId,
        minutes: round1((now - (t.startedAt ?? t.calledAt ?? t.arrivedAt).getTime()) / MIN),
      }));
      return {
        id: d.id,
        number: d.number,
        name: d.name,
        zone: d.zone,
        agent: agent
          ? {
              id: agent.userId,
              name: names.get(agent.userId) ?? {},
              status: agent.status,
              statusSinceMin: round1((now - agent.statusChangedAt.getTime()) / MIN),
            }
          : null,
        ticket: list[0] ?? null,
        /** Every visitor the agent has at the moment (several when multiple visitors are allowed). */
        tickets: list,
      };
    }),
    reasons: reasonRows
      .map((r) => {
        const w = waiting.filter((t) => t.reasonId === r.id);
        const longest = w.length ? Math.max(...w.map(waitMin)) : 0;
        return {
          id: r.id,
          name: r.name,
          color: r.color,
          waiting: w.length,
          longestWaitMin: round1(longest),
          slaMinutes: r.slaTargetWaitMinutes,
          overSla: longest > r.slaTargetWaitMinutes,
        };
      })
      .filter((r) => r.waiting > 0 || !r.overSla),
    longWaits: waiting
      .filter((t) => waitMin(t) >= settings.longWaitMinutes)
      .sort((a, b) => waitMin(b) - waitMin(a))
      .slice(0, 10)
      .map((t) => ({ ticketId: t.id, displayNumber: t.displayNumber, reasonId: t.reasonId, waitMin: round1(waitMin(t)) })),
    thresholds: { longWaitMinutes: settings.longWaitMinutes, queueLimit: settings.queueLimit },
    alerts: openAlerts.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
