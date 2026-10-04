import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  agentProfiles,
  appointments,
  branches,
  breakTypes,
  desks,
  halls,
  messageTemplates,
  priorityLevels,
  queues,
  tickets,
  users,
  visitReasons,
  visitors,
} from "@/db/schema";
import { orderTickets } from "@/domain/distribution/ordering";
import { looseNameMatch } from "@/domain/i18n/arabic-normalize";
import { branchesFor, can } from "@/domain/rbac/permissions";
import { shiftState } from "@/domain/shifts/window";
import type { Actor } from "../admin/actor";
import { AppError } from "../http/errors";
import { feedbackCardFor } from "../feedback/service";
import { getSetting } from "../settings/service";
import { pickByCity } from "../settings/templates";
import { hiddenReasonIds } from "./city-reasons";
import { breakStatus } from "./breaks";
import { hallConsole } from "../halls/views";
import { agentIssuingState } from "./reception-status";
import { loadBranchContext } from "./snapshot";
import { canOfferUpdates } from "../notifications/optin";
import { waitDisplayOf } from "./wait-analytics";
import { viewOf, type TicketView, type VisitorRow } from "./tickets";

type TicketRow = typeof tickets.$inferSelect;
export { positionsFor, type Position } from "./positions";
import { positionsFor, type Position } from "./positions";

async function visitorsFor(tx: DbOrTx, rows: TicketRow[]): Promise<Map<string, VisitorRow>> {
  const ids = [...new Set(rows.map((r) => r.visitorId).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const vs = await tx.select().from(visitors).where(inArray(visitors.id, ids));
  return new Map(vs.map((v) => [v.id, v]));
}

/** Tickets of the current service day plus any older ticket still open (not lost across midnight). */
async function branchTickets(tx: DbOrTx, branchId: string, serviceDay: string) {
  return tx
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.branchId, branchId),
        or(eq(tickets.serviceDay, serviceDay), sql`${tickets.status} in ('WAITING','CALLED','SERVING','ON_HOLD')`),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1000);
}

async function assertBranch(actor: Actor, branchId: string) {
  const [b] = await db().select().from(branches).where(eq(branches.id, branchId));
  if (!b || b.organizationId !== actor.auth.user.organizationId || b.archivedAt) throw new AppError("not_found");
  return b;
}

/**
 * Live queue state. People who handle visitors at the front (issue, edit or reassign tickets) see every visitor;
 * agents see visitor details only for tickets assigned to or served by them (data minimisation).
 */
export async function queueState(actor: Actor, branchId: string, opts: { q?: string } = {}) {
  if (!can(actor.auth.grants, "tickets.view", branchId) && !can(actor.auth.grants, "agent.serve", branchId))
    throw new AppError("forbidden");
  const fullView = (["tickets.issue", "tickets.edit", "tickets.reassign"] as const).some((p) =>
    can(actor.auth.grants, p, branchId),
  );
  await assertBranch(actor, branchId);
  return db().transaction(async (tx) => {
    const bctx = await loadBranchContext(tx, branchId);
    const s = bctx.snapshot;
    const rows = await branchTickets(tx, branchId, bctx.serviceDay);
    const vis = await visitorsFor(tx, rows);
    const me = actor.auth.user.id;
    let list = rows.map((t) => {
      const mine = t.assignedAgentId === me || t.servingAgentId === me;
      return viewOf(t, fullView || mine ? vis.get(t.visitorId ?? "") : null);
    });
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      list = list.filter(
        (v) =>
          v.displayNumber.toLowerCase().includes(q.toLowerCase()) ||
          (v.visitor?.name && looseNameMatch(v.visitor.name, q)) ||
          (v.visitor?.phone ?? "").includes(q),
      );
    }
    const waitingOrder = orderTickets(
      s.tickets.filter((t) => t.status === "WAITING"),
      s.now,
      s.configFor,
      s.reasons,
      s.priorities,
    ).map((t) => t.id);
    return {
      now: new Date(s.now).toISOString(),
      serviceDay: bctx.serviceDay,
      waitingOrder,
      positions: Object.fromEntries(positionsFor(bctx)),
      tickets: list,
      agents: s.agents.map((a) => ({
        id: a.id,
        status: a.status,
        maxConcurrent: a.maxConcurrent,
        handledToday: a.handledToday,
        reasons: [...a.skills.keys()],
      })),
      /** Live hall occupancy (D62): visitors called to or inside each hall. Empty while halls are off. */
      halls: bctx.hallSettings.enabled
        ? bctx.halls.map((h) => {
            const inside = rows.filter((t) => t.hallId === h.id && (t.status === "CALLED" || t.status === "SERVING"));
            return {
              id: h.id,
              number: h.number,
              name: h.name,
              capacity: h.capacity,
              occupied: inside.length,
              hostAgentId: h.hostAgentId,
              status: !inside.length ? "free" : inside.some((t) => t.status === "CALLED") ? "called" : "in_session",
            };
          })
        : [],
    };
  });
}

/** Branches the actor may work in for a permission, default first. */
async function workBranches(actor: Actor, permission: "tickets.issue" | "agent.serve" | "tickets.view") {
  const scope = branchesFor(actor.auth.grants, permission);
  const rows = await db()
    .select()
    .from(branches)
    .where(and(eq(branches.organizationId, actor.auth.user.organizationId), isNull(branches.archivedAt)))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt));
  return scope === "all" ? rows : rows.filter((b) => scope.includes(b.id));
}

/** Reference data for the reception console: reasons (with open/closed state), priorities, agents, settings. */
export async function receptionContext(actor: Actor, requestedBranchId?: string | null) {
  if (!can(actor.auth.grants, "tickets.issue")) throw new AppError("forbidden");
  const allowed = await workBranches(actor, "tickets.issue");
  if (!allowed.length) throw new AppError("forbidden", { reason: "no_branch" });
  const branch = allowed.find((b) => b.id === requestedBranchId) ?? allowed[0];
  return issueContext(actor, branch, allowed, { activeOnly: false });
}

/**
 * Reference data for the agent's walk-in panel (D61): the same shape as the reception context, limited to the agent's
 * own branch and to the reasons that have an active queue there. `null` when walk-in issuing is not available.
 */
export async function walkInContext(actor: Actor) {
  if (!can(actor.auth.grants, "tickets.issue_self")) throw new AppError("forbidden");
  const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, actor.auth.user.id));
  if (!profile || !can(actor.auth.grants, "tickets.issue_self", profile.branchId))
    throw new AppError("forbidden", { reason: "not_an_agent" });
  const state = await agentIssuingState(actor.auth.user.organizationId, profile.branchId);
  if (!state.allowed) throw new AppError("forbidden", { reason: "agent_issuing_off" });
  const [branch] = await db().select().from(branches).where(eq(branches.id, profile.branchId));
  return issueContext(actor, branch, [branch], { activeOnly: true });
}

async function issueContext(
  actor: Actor,
  branch: typeof branches.$inferSelect,
  allowed: (typeof branches.$inferSelect)[],
  opts: { activeOnly: boolean },
) {
  const org = actor.auth.user.organizationId;

  const [
    reasonRows,
    priorityRows,
    ctx,
    privacy,
    ticketing,
    visitorStatus,
    reception,
    wifi,
    branding,
    regional,
    printTpl,
    queueRows,
    hiddenReasons,
  ] = await Promise.all([
    db()
      .select()
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt)))
      .orderBy(asc(visitReasons.sortOrder)),
    db()
      .select()
      .from(priorityLevels)
      .where(and(eq(priorityLevels.organizationId, org), isNull(priorityLevels.archivedAt)))
      .orderBy(asc(priorityLevels.sortOrder)),
    db().transaction((tx) => loadBranchContext(tx, branch.id)),
    getSetting(org, "privacy", branch.id),
    getSetting(org, "ticketing", branch.id),
    getSetting(org, "visitorStatus", branch.id),
    getSetting(org, "reception", branch.id),
    getSetting(org, "wifi", branch.id),
    getSetting(org, "branding", branch.id),
    getSetting(org, "regional", branch.id),
    db()
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.organizationId, org),
          eq(messageTemplates.channel, "ticket_print"),
          eq(messageTemplates.event, "ticket_issued"),
          or(isNull(messageTemplates.cityId), eq(messageTemplates.cityId, branch.cityId)),
        ),
      ),
    db()
      .select({ id: queues.id, reasonId: queues.reasonId, isActive: queues.isActive })
      .from(queues)
      .where(eq(queues.branchId, branch.id)),
    hiddenReasonIds(branch.cityId),
  ]);

  // A reason is open when the branch queue is active and its city has not hidden it; hidden ones are not offered at all.
  const openReasons = new Set(queueRows.filter((q) => q.isActive && !hiddenReasons.has(q.reasonId)).map((q) => q.reasonId));
  const reasons = await Promise.all(
    reasonRows
      .filter((r) => !hiddenReasons.has(r.id) && (!opts.activeOnly || openReasons.has(r.id)))
      .map(async (r) => {
        const waiting = ctx.snapshot.tickets.filter((t) => t.reasonId === r.id && t.status === "WAITING").length;
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          icon: r.icon,
          color: r.color,
          prefix: r.prefix,
          intakeFields: r.intakeFields,
          defaultPriorityKey: r.defaultPriorityKey,
          isFeatured: r.isFeatured,
          shortcutKey: r.shortcutKey,
          allowAppointments: r.allowAppointments,
          expectedServiceMinutes: r.expectedServiceMinutes,
          waiting,
          agentsAvailable: ctx.snapshot.agents.filter((a) => a.skills.has(r.id) && a.status === "AVAILABLE").length,
        };
      }),
  );
  const agentUsers = ctx.snapshot.agents.length
    ? await db()
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          inArray(
            users.id,
            ctx.snapshot.agents.map((a) => a.id),
          ),
        )
    : [];

  return {
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    branches: allowed.map((b) => ({ id: b.id, name: b.name })),
    reasons,
    priorities: priorityRows.map((p) => ({
      key: p.key,
      name: p.name,
      color: p.color,
      icon: p.icon,
      isLane: p.isLane,
      weight: p.weight,
    })),
    agents: ctx.snapshot.agents.map((a) => ({
      id: a.id,
      displayName: agentUsers.find((u) => u.id === a.id)?.displayName ?? {},
      status: a.status,
      reasons: [...a.skills.keys()],
    })),
    /** Distribution mode per reason in this branch (manual mode lets reception pick the agent). */
    modes: Object.fromEntries(queueRows.map((q) => [q.reasonId, ctx.configFor(q.id).mode])),
    privacy: { consentText: privacy.consentText, requireConsent: privacy.requireConsent },
    ticketing,
    reception,
    wifi,
    visitorStatus,
    regional: { digitsTicket: regional.digitsTicket, digitsScreen: regional.digitsScreen },
    /** How the estimated wait is worded on the ticket and confirmation. */
    waitDisplay: waitDisplayOf(ctx.wait.settings),
    print: {
      template: pickByCity(printTpl, branch.cityId)?.body ?? null,
      footer: branding.ticketFooter,
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
    },
    canReassign: can(actor.auth.grants, "tickets.reassign", branch.id),
    canCancel: can(actor.auth.grants, "tickets.cancel", branch.id),
    canEdit: can(actor.auth.grants, "tickets.edit", branch.id),
    canCheckIn: can(actor.auth.grants, "appointments.checkin", branch.id),
  };
}

/** Everything the agent workspace needs in one call. */
export async function agentWorkspace(actor: Actor) {
  if (!can(actor.auth.grants, "agent.serve")) throw new AppError("forbidden");
  const me = actor.auth.user.id;
  const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, me));
  if (!profile) throw new AppError("forbidden", { reason: "not_an_agent" });
  const org = actor.auth.user.organizationId;
  const walkIn = can(actor.auth.grants, "tickets.issue_self", profile.branchId)
    ? await agentIssuingState(org, profile.branchId)
    : null;

  return db().transaction(async (tx) => {
    const bctx = await loadBranchContext(tx, profile.branchId);
    const s = bctx.snapshot;
    const self = s.agents.find((a) => a.id === me);
    // The agent's shift and where they stand in it; the break limit and their place in the break line.
    const sh = bctx.agentShifts.get(me);
    const myShift = sh ? { ...sh, ...shiftState(sh, bctx.now, bctx.branch.timezone) } : null;
    const breaks = await breakStatus({ tx, now: bctx.now, organizationId: org, branchId: profile.branchId, events: [] }, me);
    const myReasons = [...(self?.skills.keys() ?? [])];
    const [deskRows, breakRows, reasonRows, mineRows, agentUsers] = await Promise.all([
      tx
        .select()
        .from(desks)
        .where(and(eq(desks.branchId, profile.branchId), isNull(desks.archivedAt)))
        .orderBy(asc(desks.sortOrder), asc(desks.number)),
      tx
        .select()
        .from(breakTypes)
        .where(and(eq(breakTypes.organizationId, org), isNull(breakTypes.archivedAt)))
        .orderBy(asc(breakTypes.sortOrder)),
      tx
        .select()
        .from(visitReasons)
        .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt))),
      tx
        .select()
        .from(tickets)
        .where(
          and(
            eq(tickets.branchId, profile.branchId),
            or(
              and(eq(tickets.servingAgentId, me), inArray(tickets.status, ["CALLED", "SERVING"])),
              and(eq(tickets.assignedAgentId, me), inArray(tickets.status, ["WAITING", "ON_HOLD"])),
            ),
          ),
        )
        .orderBy(asc(tickets.queuedAt)),
      s.agents.length
        ? tx
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(
              inArray(
                users.id,
                s.agents.map((a) => a.id),
              ),
            )
        : [],
    ]);
    const vis = await visitorsFor(tx, mineRows);
    const positions = positionsFor(bctx);
    const views = mineRows.map((t) => viewOf(t, vis.get(t.visitorId ?? "")));
    // What the agent should know about a returning visitor: their previous visits (latest first).
    const visitorIds = [...new Set(mineRows.map((t) => t.visitorId).filter((x): x is string => !!x))];
    const past = visitorIds.length
      ? await tx
          .select()
          .from(tickets)
          .where(
            and(
              inArray(tickets.visitorId, visitorIds),
              notInArray(
                tickets.id,
                mineRows.map((t) => t.id),
              ),
            ),
          )
          .orderBy(desc(tickets.arrivedAt))
          .limit(visitorIds.length * 5 + 20)
      : [];
    const pastAgents = past.length
      ? await tx
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, [...new Set(past.map((p) => p.servingAgentId).filter((x): x is string => !!x))]))
      : [];
    const visitHistory: Record<
      string,
      {
        displayNumber: string;
        reasonId: string;
        arrivedAt: string;
        status: string;
        outcome: string | null;
        agentName: Record<string, string> | null;
      }[]
    > = {};
    for (const p of past) {
      const list = (visitHistory[p.visitorId!] ??= []);
      if (list.length >= 5) continue;
      list.push({
        displayNumber: p.displayNumber,
        reasonId: p.reasonId,
        arrivedAt: p.arrivedAt.toISOString(),
        status: p.status,
        outcome: p.outcome,
        agentName: pastAgents.find((u) => u.id === p.servingAgentId)?.displayName ?? null,
      });
    }
    const [today] = await tx
      .select({ served: sql<number>`count(*) filter (where ${tickets.status} = 'COMPLETED')::int` })
      .from(tickets)
      .where(and(eq(tickets.servingAgentId, me), eq(tickets.serviceDay, bctx.serviceDay)));

    return {
      now: new Date(s.now).toISOString(),
      /** Whether this agent may issue walk-in tickets from the agent screen (permission and branch setting, D61). */
      walkIn: { allowed: !!walkIn?.allowed },
      profile: {
        status: profile.status,
        statusChangedAt: profile.statusChangedAt.toISOString(),
        breakTypeId: profile.breakTypeId,
        currentDeskId: profile.currentDeskId,
        defaultDeskId: profile.defaultDeskId,
        currentHallId: profile.currentHallId,
        defaultHallId: profile.defaultHallId,
        maxConcurrent: self?.maxConcurrent ?? 1,
        servedToday: today?.served ?? 0,
      },
      branch: { id: bctx.branch.id, name: bctx.branch.name, timezone: bctx.branch.timezone },
      shift: myShift,
      shiftMode: bctx.shiftMode,
      breaks,
      desks: deskRows.map((d) => ({ id: d.id, number: d.number, name: d.name })),
      breakTypes: breakRows.map((b) => ({ id: b.id, name: b.name, maxMinutes: b.maxMinutes })),
      reasons: reasonRows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        prefix: r.prefix,
        slaTargetWaitMinutes: r.slaTargetWaitMinutes,
        intakeFields: r.intakeFields,
        serves: myReasons.includes(r.id),
      })),
      visitHistory,
      /** Visitors at the agent's desk; visitors of a hall session are in `hall.session` instead (D62). */
      active: views.filter((v) => (v.status === "CALLED" || v.status === "SERVING") && !v.hallSessionId),
      /** The hall console (D62): null while halls are off in this branch. */
      hall: await hallConsole(tx, bctx, profile),
      reserved: views.filter((v) => v.status === "WAITING").map((v) => ({ ...v, position: positions.get(v.id) ?? null })),
      onHold: views.filter((v) => v.status === "ON_HOLD"),
      queues: myReasons.map((reasonId) => {
        const waiting = s.tickets.filter((t) => t.reasonId === reasonId && t.status === "WAITING");
        const oldest = waiting.reduce((m, t) => Math.min(m, t.queuedAt), s.now);
        return {
          reasonId,
          waiting: waiting.length,
          oldestWaitMinutes: Math.round((s.now - oldest) / 60_000),
          primary: self?.skills.get(reasonId)?.isPrimary ?? false,
        };
      }),
      agents: s.agents
        .filter((a) => a.id !== me)
        .map((a) => ({
          id: a.id,
          displayName: agentUsers.find((u) => u.id === a.id)?.displayName ?? {},
          status: a.status,
          reasons: [...a.skills.keys()],
        })),
    };
  });
}

/** Reception: find a booked appointment by its code in a branch. */
export async function lookupAppointment(actor: Actor, branchId: string, code: string) {
  if (!can(actor.auth.grants, "appointments.checkin", branchId)) throw new AppError("forbidden");
  await assertBranch(actor, branchId);
  const [row] = await db()
    .select({ a: appointments, v: visitors, r: visitReasons })
    .from(appointments)
    .innerJoin(visitReasons, eq(visitReasons.id, appointments.reasonId))
    .leftJoin(visitors, eq(visitors.id, appointments.visitorId))
    .where(and(eq(appointments.branchId, branchId), eq(appointments.code, code.trim().toUpperCase())));
  if (!row) throw new AppError("not_found");
  return {
    id: row.a.id,
    code: row.a.code,
    status: row.a.status,
    scheduledAt: row.a.scheduledAt.toISOString(),
    reason: { id: row.r.id, name: row.r.name, color: row.r.color, icon: row.r.icon },
    visitor: row.v ? { name: row.v.name, phone: row.v.phone, company: row.v.company } : null,
    ticketId: row.a.ticketId,
  };
}

/** Public, token-based ticket status for the visitor's phone (no login). Contains no personal data. */
export async function publicTicketStatus(token: string) {
  const [t] = await db().select().from(tickets).where(eq(tickets.publicToken, token));
  if (!t) return null;
  const [settings, waitSettings, feedbackSettings] = await Promise.all([
    getSetting(t.organizationId, "visitorStatus", t.branchId),
    getSetting(t.organizationId, "waitEstimate", t.branchId),
    getSetting(t.organizationId, "feedback", t.branchId),
  ]);
  if (!settings.enabled) return null;
  const [reason] = await db()
    .select({ name: visitReasons.name, color: visitReasons.color, icon: visitReasons.icon, delivery: visitReasons.delivery })
    .from(visitReasons)
    .where(eq(visitReasons.id, t.reasonId));
  const [desk] = t.deskId
    ? await db().select({ number: desks.number, name: desks.name }).from(desks).where(eq(desks.id, t.deskId))
    : [];
  // The hall the visitor's group was called to (D62): number and name only.
  const [hall] = t.hallId
    ? await db().select({ number: halls.number, name: halls.name }).from(halls).where(eq(halls.id, t.hallId))
    : [];
  const [branch] = await db().select({ name: branches.name }).from(branches).where(eq(branches.id, t.branchId));
  const brand = await getSetting(t.organizationId, "branding", t.branchId);
  let position: Position | null = null;
  if (t.status === "WAITING") {
    const bctx = await db().transaction((tx) => loadBranchContext(tx, t.branchId));
    position = positionsFor(bctx).get(t.id) ?? null;
  }
  return {
    displayNumber: t.displayNumber,
    /** Last digits of the visitor's phone when the branch calls by them: what to listen and look for. */
    callCode: t.callCode,
    status: t.status,
    language: t.language,
    /** The organization's look for the page: logo, name and colours. */
    branding: {
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      logoDarkUrl: brand.logoDarkUrl,
      primaryColor: brand.primaryColor,
      accentColor: brand.accentColor,
    },
    reason: reason ? { name: reason.name, color: reason.color, icon: reason.icon } : null,
    branch: branch?.name ?? {},
    desk: desk ?? null,
    /** The hall of a called or serving hall visit; null for desk visits. */
    hall: hall && (t.status === "CALLED" || t.status === "SERVING") ? hall : null,
    /** The visit is received together with a group in a hall (the reason is delivered in halls). */
    groupVisit: reason?.delivery === "hall",
    position,
    waitDisplay: waitDisplayOf(waitSettings),
    notifyOptIn: await canOfferUpdates(t),
    arrivedAt: t.arrivedAt.toISOString(),
    calledAt: t.calledAt?.toISOString() ?? null,
    /** The rating card, only for a completed visit while feedback is on. */
    feedback: await feedbackCardFor(t),
    feedbackOnPage: feedbackSettings.showOnStatusPage,
  };
}

export type { TicketView };
