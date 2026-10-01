import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  agentProfiles,
  agentStatusLog,
  alerts,
  appointments,
  desks,
  hallSessions,
  halls,
  queues,
  ticketCounters,
  ticketEvents,
  tickets,
  visitReasons,
  visitors,
} from "@/db/schema";
import { can } from "@/domain/rbac/permissions";
import { dispatch, expiredReservations, selectTicketForAgent } from "@/domain/distribution/engine";
import { orderTickets } from "@/domain/distribution/ordering";
import { nameSkeleton, normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { formatTicketNumber } from "@/domain/i18n/digits";
import { nextNumber } from "@/domain/tickets/numbering";
import { isReasonHiddenInCity } from "./city-reasons";
import { minutesSinceEnd, shiftState } from "@/domain/shifts/window";
import { normalizePhone } from "@/domain/tickets/phone";
import {
  ACTIVE_WITH_AGENT,
  EVENT_TYPE,
  InvalidTransitionError,
  transition,
  undoTarget,
  type TicketAction,
  type TicketStatus,
} from "@/domain/tickets/state-machine";
import { uuid } from "@/domain/validation";
import { LOCALE_CODES } from "@/i18n/locales";
import type { Actor } from "../admin/actor";
import { hashPhone, randomToken } from "../crypto";
import { AppError } from "../http/errors";
import { now as clockNow } from "../clock";
import { getSetting } from "../settings/service";
import { announceHallGroup } from "../halls/announce";
import { syncHallTicket } from "../halls/sync";
import { cancelBreakRequest, offerFreedBreaks, requestBreak } from "./breaks";
import { dispatchNotifications } from "../notifications/dispatch";
import { aheadBefore, recordNotifications, type NotifyRequest } from "../notifications/record";
import { publish, type QueueEvent } from "./publish";
import { loadBranchContext, lockBranch, type BranchContext } from "./snapshot";

export type TicketRow = typeof tickets.$inferSelect;
/** Who performed a queue operation: a signed-in user, or the system (timers). */
export type QueueActor = Actor | { system: true; deviceId?: string };
export const isSystem = (a: QueueActor): a is { system: true; deviceId?: string } => "system" in a;

export type Ctx = { tx: Tx; bctx: BranchContext; events: QueueEvent[]; actor: QueueActor; notify: NotifyRequest[] };

/** Ticket events that tell the visitor something. */
const NOTIFY_ON: Record<string, NotifyRequest["event"]> = {
  ISSUED: "ticket_issued",
  CALLED: "called",
  NO_SHOW: "no_show",
  COMPLETED: "completed_thanks",
};

/** Runs a queue mutation under the branch lock and publishes realtime events after commit. */
export async function withBranch<T>(branchId: string, actor: QueueActor, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const events: QueueEvent[] = [];
  const notify: NotifyRequest[] = [];
  let outbox: string[] = [];
  const result = await db().transaction(async (tx) => {
    await lockBranch(tx, branchId);
    const bctx = await loadBranchContext(tx, branchId);
    const before = aheadBefore(bctx);
    const out = await fn({ tx, bctx, events, actor, notify });
    // Visitor messages are written to the outbox in this same transaction (nothing is lost or duplicated on rollback).
    outbox = await recordNotifications(tx, {
      bctx,
      requests: notify,
      before,
      changed: events.length > 0,
      reload: () => loadBranchContext(tx, branchId),
    });
    return out;
  });
  publish(events);
  dispatchNotifications(outbox);
  return result;
}

function actorFields(actor: QueueActor) {
  return isSystem(actor) ? { actorType: "system", actorUserId: null } : { actorType: "user", actorUserId: actor.auth.user.id };
}

export async function recordEvent(
  ctx: Ctx,
  t: TicketRow,
  e: {
    type: string;
    from?: TicketStatus | null;
    to?: TicketStatus | null;
    agentId?: string | null;
    deskId?: string | null;
    fromQueueId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  const notifyEvent = NOTIFY_ON[e.type];
  if (notifyEvent && t.visitorId) ctx.notify.push({ ticketId: t.id, event: notifyEvent });
  await ctx.tx.insert(ticketEvents).values({
    organizationId: t.organizationId,
    branchId: t.branchId,
    ticketId: t.id,
    type: e.type,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    ...actorFields(ctx.actor),
    agentId: e.agentId ?? null,
    deskId: e.deskId ?? null,
    queueId: t.queueId,
    fromQueueId: e.fromQueueId ?? null,
    payload: e.payload ?? {},
    at: new Date(ctx.bctx.now),
  });
}

/** Updates a ticket only if it is still in the expected status; otherwise someone else changed it first. */
export async function guardedUpdate(ctx: Ctx, t: TicketRow, patch: Partial<typeof tickets.$inferInsert>): Promise<TicketRow> {
  const [row] = await ctx.tx
    .update(tickets)
    .set({ ...patch, version: sql`${tickets.version} + 1` })
    .where(and(eq(tickets.id, t.id), eq(tickets.status, t.status), eq(tickets.version, t.version)))
    .returning();
  if (!row) throw new AppError("conflict", { reason: "ticket_changed" });
  return row;
}

export function next(t: TicketRow, action: TicketAction): TicketStatus {
  try {
    return transition(t.status, action);
  } catch (err) {
    if (err instanceof InvalidTransitionError) throw new AppError("invalid_transition", { from: t.status, action });
    throw err;
  }
}

export async function loadTicket(tx: Tx, organizationId: string, id: string): Promise<TicketRow> {
  const [t] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.organizationId, organizationId)));
  if (!t) throw new AppError("not_found");
  return t;
}

/**
 * After any change: release reservations whose agent left or whose hybrid accept time passed, then let the
 * engine reserve agents for unassigned tickets (push / hybrid / sticky). Everything is persisted with events.
 */
export async function rebalance(ctx: Ctx) {
  const fresh = await loadBranchContext(ctx.tx, ctx.bctx.branch.id, ctx.bctx.now);
  const s = fresh.snapshot;
  for (const r of expiredReservations(s)) {
    const [row] = await ctx.tx
      .update(tickets)
      .set({ assignedAgentId: null, assignedAt: null, version: sql`${tickets.version} + 1` })
      .where(and(eq(tickets.id, r.ticketId), eq(tickets.status, "WAITING")))
      .returning();
    if (!row) continue;
    await recordEvent(ctx, row, { type: "RELEASED", agentId: r.agentId, payload: { cause: r.cause } });
    const cfg = s.configFor(row.queueId);
    if (r.cause === "accept_timeout" && cfg.hybrid.alertSupervisor) {
      await ctx.tx.insert(alerts).values({
        organizationId: row.organizationId,
        branchId: row.branchId,
        type: "hybrid_release",
        severity: "warning",
        payload: { ticketId: row.id, displayNumber: row.displayNumber, agentId: r.agentId },
        dedupeKey: `hybrid_release:${row.id}:${r.agentId}`,
      });
      ctx.events.push({
        type: "alert.raised",
        branchId: row.branchId,
        alertType: "hybrid_release",
        payload: { ticketId: row.id, displayNumber: row.displayNumber },
      });
    }
    const t = s.tickets.find((x) => x.id === r.ticketId);
    if (t) {
      t.assignedAgentId = null;
      t.assignedAt = null;
    }
  }
  for (const a of dispatch(s)) {
    const [row] = await ctx.tx
      .update(tickets)
      .set({ assignedAgentId: a.agentId, assignedAt: new Date(s.now), version: sql`${tickets.version} + 1` })
      .where(and(eq(tickets.id, a.ticketId), eq(tickets.status, "WAITING"), sql`${tickets.assignedAgentId} is null`))
      .returning();
    if (row) await recordEvent(ctx, row, { type: "ASSIGNED", agentId: a.agentId, payload: { via: a.via } });
  }
  ctx.bctx = fresh;
  ctx.events.push({ type: "queue.updated", branchId: fresh.branch.id, cause: "rebalance" });
}

// ─── Issue ───────────────────────────────────────────────────────────────────

export const issueInput = z.object({
  branchId: uuid,
  reasonId: uuid,
  priorityKey: z.string().max(40).nullable().optional(),
  language: z.enum(LOCALE_CODES as [string, ...string[]]).default("ar"),
  /** Values for the reason's intake fields (name, phone, company, national_id_last4, email, notes, custom…). */
  fields: z.record(z.string(), z.string().max(500)).default({}),
  consent: z.boolean().default(false),
  /** Manual mode: the receptionist picks the agent. */
  assignToAgentId: uuid.nullable().optional(),
  appointmentId: uuid.nullable().optional(),
  source: z.enum(["reception", "agent", "kiosk", "appointment", "api"]).default("reception"),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type IssueInput = z.infer<typeof issueInput>;

export type IssuedTicket = {
  ticket: TicketView;
  ahead: number;
  estimatedWaitMinutes: number;
  waitLow: number;
  waitHigh: number;
  duplicate: boolean;
};

async function upsertVisitor(ctx: Ctx, orgId: string, fields: Record<string, string>, language: string) {
  const name = fields.name?.trim() || null;
  const { phoneCountryCode } = await getSetting(orgId, "regional", ctx.bctx.branch.id, ctx.tx);
  const phone = normalizePhone(fields.phone, phoneCountryCode);
  const company = fields.company?.trim() || null;
  if (!name && !phone && !company) return null;
  const phoneHash = phone ? hashPhone(phone) : null;
  const values = {
    name,
    nameSearch: name ? normalizeArabic(name) : null,
    nameTranslit: name ? nameSkeleton(name) : null,
    phone,
    phoneHash,
    company,
    preferredLanguage: language,
  };
  if (phoneHash) {
    const [existing] = await ctx.tx
      .select()
      .from(visitors)
      .where(and(eq(visitors.organizationId, orgId), eq(visitors.phoneHash, phoneHash)))
      .limit(1);
    if (existing) {
      const [row] = await ctx.tx
        .update(visitors)
        .set({
          ...values,
          name: name ?? existing.name,
          nameSearch: values.nameSearch ?? existing.nameSearch,
          nameTranslit: values.nameTranslit ?? existing.nameTranslit,
          company: company ?? existing.company,
        })
        .where(eq(visitors.id, existing.id))
        .returning();
      return row;
    }
  }
  const [row] = await ctx.tx
    .insert(visitors)
    .values({ organizationId: orgId, ...values })
    .returning();
  return row;
}

/** Extra rules for the ways a ticket is issued other than at the reception desk (D61). */
export type IssueOptions = {
  /** Agent walk-in "serve now": the issuing agent takes the new ticket at once (their capacity and skills apply). */
  serve?: { agentId: string; deskId: string };
  /** Self check-in: a phone number that already has a waiting ticket in the branch gets that ticket back. */
  dedupePhone?: boolean;
  /** Self check-in: refuse a new ticket when this many visitors are already waiting in the branch (0 or unset = no limit). */
  maxWaiting?: number;
  /** A device (kiosk) is not a person: it names its organization so retries with the same idempotency key are recognised. */
  organizationId?: string;
};

/** Reception issuing (needs `tickets.issue`). Agents and kiosks go through `issueTicketWith`. */
export async function issueTicket(actor: QueueActor, input: IssueInput): Promise<IssuedTicket> {
  if (!isSystem(actor) && !can(actor.auth.grants, "tickets.issue", input.branchId)) throw new AppError("forbidden");
  return issueTicketWith(actor, input, {});
}

/** The issuing service without the reception permission check: callers check their own permission or device. */
export async function issueTicketWith(actor: QueueActor, input: IssueInput, opts: IssueOptions): Promise<IssuedTicket> {
  const orgId = isSystem(actor) ? (opts.organizationId ?? null) : actor.auth.user.organizationId;

  if (input.idempotencyKey && orgId) {
    const [dup] = await db()
      .select()
      .from(tickets)
      .where(and(eq(tickets.organizationId, orgId), eq(tickets.idempotencyKey, input.idempotencyKey)));
    if (dup) return { ...(await describePosition(dup)), duplicate: true };
  }

  return withBranch(input.branchId, actor, async (ctx) => {
    const { tx, bctx } = ctx;
    const org = bctx.branch.organizationId;
    if (orgId && orgId !== org) throw new AppError("not_found");
    const [reason] = await tx
      .select()
      .from(visitReasons)
      .where(and(eq(visitReasons.id, input.reasonId), eq(visitReasons.organizationId, org)));
    if (!reason || reason.archivedAt) throw new AppError("validation", { field: "reasonId" });
    const [queue] = await tx
      .select()
      .from(queues)
      .where(and(eq(queues.branchId, bctx.branch.id), eq(queues.reasonId, reason.id)));
    if (!queue || !queue.isActive || (await isReasonHiddenInCity(bctx.branch.cityId, reason.id, tx)))
      throw new AppError("validation", { field: "reasonId" });

    // Data minimisation: only fields configured for this reason are accepted; required ones must be present.
    const allowed = new Map(reason.intakeFields.map((f) => [f.key, f]));
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.fields)) {
      if (!allowed.has(k)) throw new AppError("validation", { reason: "unexpected_field", field: k });
      if (v.trim()) fields[k] = v.trim();
    }
    for (const f of reason.intakeFields)
      if (f.required && !fields[f.key]) throw new AppError("validation", { reason: "missing_field", field: f.key });
    if (
      fields.national_id_last4 &&
      !/^\d{4}$/.test(fields.national_id_last4.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)))
    ) {
      throw new AppError("validation", { reason: "invalid_field", field: "national_id_last4" });
    }
    if (fields.phone && !normalizePhone(fields.phone))
      throw new AppError("validation", { reason: "invalid_field", field: "phone" });
    const privacy = await getSetting(org, "privacy", bctx.branch.id, tx);
    if (privacy.requireConsent && Object.keys(fields).length > 0 && !input.consent)
      throw new AppError("validation", { reason: "consent_required" });

    if (opts.maxWaiting && opts.maxWaiting > 0) {
      const waiting = bctx.snapshot.tickets.filter((x) => x.status === "WAITING").length;
      if (waiting >= opts.maxWaiting) throw new AppError("conflict", { reason: "queue_full" });
    }
    if (opts.dedupePhone && fields.phone) {
      const { phoneCountryCode } = await getSetting(org, "regional", bctx.branch.id, tx);
      const phone = normalizePhone(fields.phone, phoneCountryCode);
      if (phone) {
        const [dup] = await tx
          .select({ ticket: tickets })
          .from(tickets)
          .innerJoin(visitors, eq(visitors.id, tickets.visitorId))
          .where(
            and(
              eq(tickets.branchId, bctx.branch.id),
              eq(tickets.status, "WAITING"),
              eq(visitors.organizationId, org),
              eq(visitors.phoneHash, hashPhone(phone)),
            ),
          )
          .limit(1);
        if (dup) return { ...positionIn(bctx, dup.ticket), ticket: await toView(tx, dup.ticket), duplicate: true };
      }
    }

    // Number: atomic per (branch, prefix, service day).
    const prefix = queue.prefix || reason.prefix;
    const [counter] = await tx
      .insert(ticketCounters)
      .values({ branchId: bctx.branch.id, prefix, serviceDay: bctx.serviceDay, lastNumber: 0 })
      .onConflictDoUpdate({
        target: [ticketCounters.branchId, ticketCounters.prefix, ticketCounters.serviceDay],
        set: { lastNumber: sql`${ticketCounters.lastNumber}` },
      })
      .returning();
    const number = nextNumber(counter.lastNumber, { start: queue.numberStart, end: queue.numberEnd });
    if (number === null) throw new AppError("conflict", { reason: "range_exhausted" });
    await tx
      .update(ticketCounters)
      .set({ lastNumber: number })
      .where(
        and(
          eq(ticketCounters.branchId, bctx.branch.id),
          eq(ticketCounters.prefix, prefix),
          eq(ticketCounters.serviceDay, bctx.serviceDay),
        ),
      );
    const ticketing = await getSetting(org, "ticketing", bctx.branch.id, tx);

    const visitor = await upsertVisitor(ctx, org, fields, input.language);
    let appointmentAt: Date | null = null;
    if (input.appointmentId) {
      const [appt] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.branchId, bctx.branch.id)));
      if (!appt || appt.status !== "BOOKED") throw new AppError("validation", { field: "appointmentId" });
      appointmentAt = appt.scheduledAt;
    }

    const now = new Date(bctx.now);
    const intake = Object.fromEntries(Object.entries(fields).filter(([k]) => !["name", "phone", "company", "notes"].includes(k)));
    const [t] = await tx
      .insert(tickets)
      .values({
        organizationId: org,
        branchId: bctx.branch.id,
        queueId: queue.id,
        reasonId: reason.id,
        visitorId: visitor?.id ?? null,
        appointmentId: input.appointmentId ?? null,
        prefix,
        number,
        displayNumber: formatTicketNumber(prefix, number, { pad: ticketing.numberPad, separator: ticketing.separator }),
        serviceDay: bctx.serviceDay,
        status: "WAITING",
        priorityKey: input.priorityKey ?? reason.defaultPriorityKey ?? null,
        language: input.language,
        publicToken: randomToken(),
        arrivedAt: now,
        queuedAt: now,
        notes: fields.notes ?? null,
        intake,
        consentAt: input.consent ? now : null,
        source: input.source,
        issuedByUserId: isSystem(actor) ? null : actor.auth.user.id,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await recordEvent(ctx, t, {
      type: "ISSUED",
      to: "WAITING",
      payload: {
        source: input.source,
        appointmentAt: appointmentAt?.toISOString(),
        ...(isSystem(actor) && actor.deviceId ? { deviceId: actor.deviceId } : {}),
        ...(opts.serve ? { serveNow: true } : {}),
      },
    });
    if (input.appointmentId) {
      await tx.update(appointments).set({ status: "CHECKED_IN", ticketId: t.id }).where(eq(appointments.id, input.appointmentId));
    }

    if (input.assignToAgentId) {
      const cfg = bctx.configFor(queue.id);
      const allowedToAssign =
        isSystem(actor) || cfg.mode === "manual" || can(actor.auth.grants, "tickets.reassign", bctx.branch.id);
      if (!allowedToAssign) throw new AppError("forbidden", { reason: "assign" });
      if (reason.delivery === "hall")
        throw new AppError("validation", { reason: "hall_reason_no_agent", field: "assignToAgentId" });
      await assertAgentCanServe(ctx, input.assignToAgentId, reason.id);
      const row = await guardedUpdate(ctx, t, { assignedAgentId: input.assignToAgentId, assignedAt: now });
      await recordEvent(ctx, row, { type: "ASSIGNED", agentId: input.assignToAgentId, payload: { via: "manual" } });
    }

    if (opts.serve) await serveNow(ctx, t, opts.serve);

    ctx.events.push({ type: "queue.updated", branchId: t.branchId, cause: "issued", ticketId: t.id });
    await rebalance(ctx);
    const [latest] = await tx.select().from(tickets).where(eq(tickets.id, t.id));
    return { ...positionIn(ctx.bctx, latest), ticket: await toView(tx, latest), duplicate: false };
  });
}

/**
 * Agent walk-in "serve now": the ticket that was just issued goes straight to the issuing agent (called, then
 * serving) without announcing it on the screens, since the visitor is standing at the desk. Nobody else's place in
 * the line changes, and the agent's own capacity (several visitors at once) is respected.
 */
async function serveNow(ctx: Ctx, t: TicketRow, serve: { agentId: string; deskId: string }) {
  const agent = ctx.bctx.snapshot.agents.find((a) => a.id === serve.agentId);
  if (!agent || !agent.skills.has(t.reasonId) || agent.inHall || ctx.bctx.hallReasonIds.has(t.reasonId))
    throw new AppError("validation", { reason: "agent_cannot_serve", field: "reasonId" });
  const busy = ctx.bctx.snapshot.tickets.filter((x) => x.servingAgentId === agent.id && ACTIVE_WITH_AGENT.has(x.status)).length;
  if (busy >= agent.maxConcurrent) throw new AppError("conflict", { reason: "at_capacity" });
  if (agent.status !== "AVAILABLE" || (await agentProfile(ctx.tx, agent.id)).currentDeskId !== serve.deskId) {
    await setStatusInTx(ctx, agent.id, "AVAILABLE", { deskId: serve.deskId });
  }
  const now = new Date(ctx.bctx.now);
  const called = await guardedUpdate(ctx, t, {
    status: next(t, "call"),
    servingAgentId: agent.id,
    assignedAgentId: agent.id,
    assignedAt: now,
    deskId: serve.deskId,
    calledAt: now,
    recallCount: 0,
  });
  await recordEvent(ctx, called, {
    type: "CALLED",
    from: t.status,
    to: called.status,
    agentId: agent.id,
    deskId: serve.deskId,
    payload: { serveNow: true },
  });
  const serving = await guardedUpdate(ctx, called, { status: next(called, "start"), startedAt: now });
  await recordEvent(ctx, serving, {
    type: EVENT_TYPE.start,
    from: called.status,
    to: serving.status,
    agentId: agent.id,
    deskId: serve.deskId,
  });
}

async function assertAgentCanServe(ctx: Ctx, agentId: string, reasonId: string) {
  const agent = ctx.bctx.snapshot.agents.find((a) => a.id === agentId);
  if (!agent || !agent.skills.has(reasonId)) throw new AppError("validation", { reason: "agent_cannot_serve", field: "agentId" });
}

/** Position of a waiting ticket among waiting tickets of the same reason, and the estimated wait. */
function positionIn(
  bctx: BranchContext,
  t: TicketRow,
): { ahead: number; estimatedWaitMinutes: number; waitLow: number; waitHigh: number } {
  if (t.status !== "WAITING") return { ahead: 0, estimatedWaitMinutes: 0, waitLow: 0, waitHigh: 0 };
  const s = bctx.snapshot;
  const same = s.tickets.filter((x) => x.reasonId === t.reasonId && x.status === "WAITING");
  const ordered = orderTickets(same, s.now, s.configFor, s.reasons, s.priorities);
  const ahead = Math.max(
    0,
    ordered.findIndex((x) => x.id === t.id),
  );
  const agents = s.agents.filter((a) => a.skills.has(t.reasonId) && (a.status === "AVAILABLE" || a.status === "BUSY")).length;
  const e = bctx.waitFor(t.reasonId, ahead, agents);
  return { ahead, estimatedWaitMinutes: e.minutes, waitLow: e.low, waitHigh: e.high };
}

export async function describePosition(t: TicketRow): Promise<Omit<IssuedTicket, "duplicate">> {
  return db().transaction(async (tx) => {
    const bctx = await loadBranchContext(tx, t.branchId);
    return { ...positionIn(bctx, t), ticket: await toView(tx, t) };
  });
}

// ─── Agent workflow ──────────────────────────────────────────────────────────

export async function agentProfile(tx: DbOrTx, userId: string) {
  const [p] = await tx.select().from(agentProfiles).where(eq(agentProfiles.userId, userId));
  if (!p) throw new AppError("forbidden", { reason: "not_an_agent" });
  return p;
}

export function requireAgent(actor: QueueActor): Actor {
  if (isSystem(actor)) throw new AppError("forbidden");
  if (!can(actor.auth.grants, "agent.serve")) throw new AppError("forbidden");
  return actor;
}

export async function setStatusInTx(
  ctx: Ctx,
  userId: string,
  status: (typeof agentProfiles.$inferSelect)["status"],
  opts: { breakTypeId?: string | null; deskId?: string | null; hallId?: string | null } = {},
) {
  const p = await agentProfile(ctx.tx, userId);
  // An agent works at a desk or hosts a hall, never both: choosing one clears the other (D62).
  let deskId = opts.deskId !== undefined ? opts.deskId : p.currentDeskId;
  let hallId = opts.hallId !== undefined ? opts.hallId : p.currentHallId;
  if (opts.hallId) deskId = null;
  else if (opts.deskId) hallId = null;
  if (
    p.status === status &&
    deskId === p.currentDeskId &&
    hallId === p.currentHallId &&
    (opts.breakTypeId ?? null) === p.breakTypeId
  )
    return;
  await ctx.tx
    .update(agentProfiles)
    .set({
      status,
      statusChangedAt: new Date(ctx.bctx.now),
      breakTypeId: status === "ON_BREAK" ? (opts.breakTypeId ?? null) : null,
      currentDeskId: deskId,
      currentHallId: hallId,
    })
    .where(eq(agentProfiles.userId, userId));
  await ctx.tx.insert(agentStatusLog).values({
    organizationId: p.organizationId,
    branchId: p.branchId,
    userId,
    status,
    breakTypeId: status === "ON_BREAK" ? (opts.breakTypeId ?? null) : null,
    deskId,
    at: new Date(ctx.bctx.now),
  });
  ctx.events.push({ type: "agent.updated", branchId: p.branchId, agentId: userId, status });
}

export const statusInput = z.object({
  status: z.enum(["AVAILABLE", "BUSY", "ON_BREAK", "AWAY", "OFFLINE"]),
  breakTypeId: uuid.nullable().optional(),
  deskId: uuid.nullable().optional(),
  /** Sign in to a hall as its host (D62) instead of a desk. */
  hallId: uuid.nullable().optional(),
});

/**
 * Hall rules for a status change (D62): a hall needs the feature switched on and belongs to the agent's branch; one
 * host per hall; and a host with a live group session stays until it is closed or cancelled.
 */
export async function assertHallSignIn(
  ctx: Ctx,
  userId: string,
  p: { branchId: string; currentHallId: string | null; currentDeskId: string | null },
  input: { status: string; deskId?: string | null; hallId?: string | null },
) {
  const [live] = await ctx.tx
    .select({ id: hallSessions.id })
    .from(hallSessions)
    .where(and(eq(hallSessions.hostAgentId, userId), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
  const leaving = input.status === "OFFLINE" || input.status === "ON_BREAK" || input.status === "AWAY";
  if (
    live &&
    (leaving || (input.deskId && input.deskId !== p.currentDeskId) || (input.hallId && input.hallId !== p.currentHallId))
  )
    throw new AppError("conflict", { reason: "hall_session_open" });
  if (!input.hallId) return;
  if (!ctx.bctx.hallSettings.enabled) throw new AppError("conflict", { reason: "halls_disabled" });
  const [hall] = await ctx.tx.select().from(halls).where(eq(halls.id, input.hallId));
  if (!hall || hall.branchId !== p.branchId || hall.archivedAt) throw new AppError("validation", { field: "hallId" });
  const [other] = await ctx.tx
    .select({ id: agentProfiles.userId })
    .from(agentProfiles)
    .where(and(eq(agentProfiles.currentHallId, hall.id), ne(agentProfiles.userId, userId), ne(agentProfiles.status, "OFFLINE")));
  if (other) throw new AppError("conflict", { reason: "hall_taken" });
}

/** Agent status toggle. Leaving work releases reservations; becoming available triggers push assignment. */
export async function setAgentStatus(actor: QueueActor, input: z.infer<typeof statusInput>) {
  const agent = requireAgent(actor);
  const p = await agentProfile(db(), agent.auth.user.id);
  if (input.deskId) {
    const [d] = await db().select().from(desks).where(eq(desks.id, input.deskId));
    if (!d || d.branchId !== p.branchId || d.archivedAt) throw new AppError("validation", { field: "deskId" });
  }
  if (input.deskId && input.hallId) throw new AppError("validation", { reason: "desk_or_hall" });
  return withBranch(p.branchId, actor, async (ctx) => {
    const userId = agent.auth.user.id;
    const breaks = breakCtx(ctx, p);
    // Strict shifts: nobody starts work outside their shift.
    if ((input.status === "AVAILABLE" || input.status === "BUSY") && ctx.bctx.shiftMode === "strict") {
      const shift = ctx.bctx.agentShifts.get(userId);
      const state = shift && shiftState(shift, ctx.bctx.now, ctx.bctx.branch.timezone);
      if (shift && state && !state.onShift) {
        throw new AppError("conflict", {
          reason: "off_shift",
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          startsInMinutes: state.startsInMinutes,
        });
      }
    }
    // A break may be limited: when the limit is reached the agent joins the line instead and is told so.
    if (input.status === "ON_BREAK") {
      const decision = await requestBreak(breaks, userId, input.breakTypeId ?? null);
      if (!decision.granted) {
        return {
          status: p.status,
          breakQueued: { onBreak: decision.onBreak, limit: decision.limit, position: decision.position },
        };
      }
    } else {
      await cancelBreakRequest(breaks, userId);
    }
    await assertHallSignIn(ctx, userId, p, input);
    await setStatusInTx(ctx, userId, input.status, {
      breakTypeId: input.breakTypeId,
      deskId: input.deskId,
      hallId: input.hallId,
    });
    // Someone leaving a break (or going offline) frees a place for the next agent in line.
    await offerFreedBreaks(breaks);
    await rebalance(ctx);
    return { status: input.status, breakQueued: null };
  });
}

/**
 * Call next. Two agents pressing at the same moment are serialized by the branch lock, and the guarded update
 * (status must still be WAITING, version unchanged) makes a double assignment impossible.
 */
export async function callNext(actor: QueueActor, input: { deskId?: string | null } = {}) {
  const agent = requireAgent(actor);
  const userId = agent.auth.user.id;
  const p = await agentProfile(db(), userId);
  return withBranch(p.branchId, actor, async (ctx) => {
    // A host calls groups with the hall console; the desk queue is for agents at a desk (D62).
    if (p.currentHallId && !input.deskId) throw new AppError("conflict", { reason: "hall_mode" });
    const deskId = input.deskId ?? p.currentDeskId ?? p.defaultDeskId;
    if (!deskId) throw new AppError("validation", { reason: "desk_required" });
    if (p.currentHallId && deskId !== p.currentDeskId) {
      const [live] = await ctx.tx
        .select({ id: hallSessions.id })
        .from(hallSessions)
        .where(and(eq(hallSessions.hostAgentId, userId), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
      if (live) throw new AppError("conflict", { reason: "hall_session_open" });
    }
    // Pressing "call next" means the agent is ready: end a break / busy / offline state.
    if (p.status !== "AVAILABLE" || deskId !== p.currentDeskId) {
      await setStatusInTx(ctx, userId, "AVAILABLE", { deskId });
      const a = ctx.bctx.snapshot.agents.find((x) => x.id === userId);
      if (a) a.status = "AVAILABLE";
    }
    const decision = selectTicketForAgent(ctx.bctx.snapshot, userId);
    if (!decision.ticket) return { ticket: null, reason: decision.reason };
    const t = await loadTicket(ctx.tx, p.organizationId, decision.ticket.id);
    const now = new Date(ctx.bctx.now);
    const row = await guardedUpdate(ctx, t, {
      status: next(t, "call"),
      servingAgentId: userId,
      assignedAgentId: userId,
      assignedAt: t.assignedAt ?? now,
      deskId,
      calledAt: now,
      recallCount: 0,
    });
    await recordEvent(ctx, row, {
      type: "CALLED",
      from: t.status,
      to: row.status,
      agentId: userId,
      deskId,
      payload: { reserved: decision.reserved },
    });
    await announce(ctx, row, false);
    ctx.events.push({ type: "queue.updated", branchId: row.branchId, cause: "called", ticketId: row.id });
    return { ticket: await toView(ctx.tx, row), reason: null };
  });
}

async function announce(ctx: Ctx, t: TicketRow, recall: boolean) {
  if (t.hallSessionId) {
    await announceHallGroup(ctx, t.hallSessionId, { recall, ticketIds: [t.id] });
    return;
  }
  const [desk] = t.deskId ? await ctx.tx.select().from(desks).where(eq(desks.id, t.deskId)) : [];
  ctx.events.push({
    type: "ticket.called",
    branchId: t.branchId,
    ticketId: t.id,
    displayNumber: t.displayNumber,
    deskId: t.deskId,
    deskNumber: desk?.number ?? null,
    agentId: t.servingAgentId!,
    reasonId: t.reasonId,
    language: t.language,
    recall,
  });
}

// ─── Ticket actions ──────────────────────────────────────────────────────────

export const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recall") }),
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("complete"),
    outcome: z.string().max(60).optional(),
    notes: z.string().max(2000).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
  }),
  z.object({ action: z.literal("no_show") }),
  z.object({ action: z.literal("hold") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel"), note: z.string().max(500).optional() }),
  z.object({
    action: z.literal("transfer"),
    toReasonId: uuid.optional(),
    toAgentId: uuid.nullable().optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("assign"), agentId: uuid.nullable() }),
  z.object({ action: z.literal("undo") }),
  z.object({ action: z.literal("check_in") }),
  z.object({
    action: z.literal("edit"),
    priorityKey: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    language: z.enum(LOCALE_CODES as [string, ...string[]]).optional(),
  }),
]);
export type TicketActionInput = z.infer<typeof actionInput>;

/** Serving-agent actions must come from the agent holding the ticket (or a supervisor who may reassign). */
function assertOwnerOrSupervisor(actor: QueueActor, t: TicketRow) {
  if (isSystem(actor)) return;
  if (t.servingAgentId === actor.auth.user.id) return;
  if (can(actor.auth.grants, "tickets.reassign", t.branchId)) return;
  throw new AppError("forbidden", { reason: "not_your_ticket" });
}

function assertPermission(actor: QueueActor, permission: Parameters<typeof can>[1], branchId: string) {
  if (isSystem(actor)) return;
  if (!can(actor.auth.grants, permission, branchId)) throw new AppError("forbidden");
}

export async function ticketAction(actor: QueueActor, ticketId: string, input: TicketActionInput) {
  const orgId = isSystem(actor) ? undefined : actor.auth.user.organizationId;
  const [head] = await db()
    .select({ branchId: tickets.branchId, organizationId: tickets.organizationId })
    .from(tickets)
    .where(orgId ? and(eq(tickets.id, ticketId), eq(tickets.organizationId, orgId)) : eq(tickets.id, ticketId));
  if (!head) throw new AppError("not_found");

  return withBranch(head.branchId, actor, async (ctx) => {
    const t = await loadTicket(ctx.tx, head.organizationId, ticketId);
    const now = new Date(ctx.bctx.now);
    const cfg = ctx.bctx.configFor(t.queueId);
    let row: TicketRow;

    switch (input.action) {
      case "recall": {
        assertOwnerOrSupervisor(actor, t);
        row = await guardedUpdate(ctx, t, { status: next(t, "recall"), recallCount: t.recallCount + 1, calledAt: now });
        await recordEvent(ctx, row, {
          type: EVENT_TYPE.recall,
          from: t.status,
          to: row.status,
          agentId: t.servingAgentId,
          deskId: t.deskId,
          payload: { count: row.recallCount },
        });
        await announce(ctx, row, true);
        break;
      }
      case "start": {
        assertOwnerOrSupervisor(actor, t);
        row = await startTicket(ctx, t);
        break;
      }
      case "complete": {
        assertOwnerOrSupervisor(actor, t);
        row = await completeTicket(ctx, t, input);
        break;
      }
      case "no_show": {
        assertOwnerOrSupervisor(actor, t);
        row = await noShow(ctx, t, "manual");
        break;
      }
      case "hold": {
        if (t.status === "WAITING") assertPermission(actor, "tickets.edit", t.branchId);
        else assertOwnerOrSupervisor(actor, t);
        // The ticket comes back to the same agent when the visitor returns.
        row = await guardedUpdate(ctx, t, {
          status: next(t, "hold"),
          assignedAgentId: t.servingAgentId ?? t.assignedAgentId,
          servingAgentId: null,
        });
        await recordEvent(ctx, row, { type: EVENT_TYPE.hold, from: t.status, to: row.status, agentId: t.servingAgentId });
        await markIdleIfFree(ctx, t.servingAgentId);
        break;
      }
      case "resume": {
        if (!isSystem(actor) && !(can(actor.auth.grants, "tickets.edit", t.branchId) || t.assignedAgentId === actor.auth.user.id))
          throw new AppError("forbidden");
        row = await guardedUpdate(ctx, t, { status: next(t, "resume"), assignedAt: t.assignedAgentId ? now : null });
        await recordEvent(ctx, row, { type: EVENT_TYPE.resume, from: t.status, to: row.status });
        break;
      }
      case "cancel": {
        if (!(t.servingAgentId && !isSystem(actor) && t.servingAgentId === actor.auth.user.id))
          assertPermission(actor, "tickets.cancel", t.branchId);
        row = await guardedUpdate(ctx, t, { status: next(t, "cancel"), finishedAt: now });
        await recordEvent(ctx, row, {
          type: EVENT_TYPE.cancel,
          from: t.status,
          to: row.status,
          agentId: t.servingAgentId,
          payload: { note: input.note },
        });
        await markIdleIfFree(ctx, t.servingAgentId);
        break;
      }
      case "transfer": {
        if (t.status === "WAITING" || t.status === "ON_HOLD") assertPermission(actor, "tickets.reassign", t.branchId);
        else assertOwnerOrSupervisor(actor, t);
        if (input.toAgentId && ctx.bctx.hallReasonIds.has(input.toReasonId ?? t.reasonId))
          throw new AppError("validation", { reason: "hall_reason_no_agent", field: "toAgentId" });
        let queueId = t.queueId;
        let reasonId = t.reasonId;
        if (input.toReasonId && input.toReasonId !== t.reasonId) {
          const [q] = await ctx.tx
            .select()
            .from(queues)
            .where(and(eq(queues.branchId, t.branchId), eq(queues.reasonId, input.toReasonId)));
          if (!q || !q.isActive || (await isReasonHiddenInCity(ctx.bctx.branch.cityId, q.reasonId, ctx.tx)))
            throw new AppError("validation", { field: "toReasonId" });
          queueId = q.id;
          reasonId = q.reasonId;
        }
        if (input.toAgentId) await assertAgentCanServe(ctx, input.toAgentId, reasonId);
        if (!input.toReasonId && !input.toAgentId) throw new AppError("validation", { reason: "transfer_target" });
        // Original arrival and queue position are kept, so the visitor does not wait twice.
        row = await guardedUpdate(ctx, t, {
          status: next(t, "transfer"),
          queueId,
          reasonId,
          assignedAgentId: input.toAgentId ?? null,
          assignedAt: input.toAgentId ? now : null,
          servingAgentId: null,
          deskId: null,
          calledAt: null,
          startedAt: null,
          recallCount: 0,
          hallId: null,
          hallSessionId: null,
        });
        await recordEvent(ctx, row, {
          type: EVENT_TYPE.transfer,
          from: t.status,
          to: row.status,
          agentId: t.servingAgentId,
          fromQueueId: t.queueId,
          payload: { toAgentId: input.toAgentId ?? null, toReasonId: reasonId, note: input.note },
        });
        await markIdleIfFree(ctx, t.servingAgentId);
        break;
      }
      case "assign": {
        const manual = cfg.mode === "manual" && !isSystem(actor) && can(actor.auth.grants, "tickets.issue", t.branchId);
        if (!manual) assertPermission(actor, "tickets.reassign", t.branchId);
        if (input.agentId && ctx.bctx.hallReasonIds.has(t.reasonId))
          throw new AppError("validation", { reason: "hall_reason_no_agent", field: "agentId" });
        if (input.agentId) await assertAgentCanServe(ctx, input.agentId, t.reasonId);
        row = await guardedUpdate(ctx, t, {
          status: next(t, input.agentId ? "assign" : "release"),
          assignedAgentId: input.agentId,
          assignedAt: input.agentId ? now : null,
        });
        await recordEvent(ctx, row, {
          type: input.agentId ? "ASSIGNED" : "RELEASED",
          agentId: input.agentId ?? t.assignedAgentId,
          payload: { via: "manual" },
        });
        break;
      }
      case "check_in": {
        assertPermission(actor, "appointments.checkin", t.branchId);
        row = await guardedUpdate(ctx, t, { status: next(t, "check_in"), queuedAt: now });
        await recordEvent(ctx, row, { type: EVENT_TYPE.check_in, from: t.status, to: row.status });
        break;
      }
      case "edit": {
        assertPermission(actor, "tickets.edit", t.branchId);
        row = await guardedUpdate(ctx, t, {
          priorityKey: input.priorityKey !== undefined ? input.priorityKey : t.priorityKey,
          notes: input.notes !== undefined ? input.notes : t.notes,
          language: input.language ?? t.language,
        });
        await recordEvent(ctx, row, { type: "EDITED", payload: { priorityKey: input.priorityKey, language: input.language } });
        break;
      }
      case "undo": {
        const [last] = await ctx.tx
          .select()
          .from(ticketEvents)
          .where(eq(ticketEvents.ticketId, t.id))
          .orderBy(desc(ticketEvents.at))
          .limit(1);
        const target = last
          ? undoTarget(
              { type: last.type, fromStatus: last.fromStatus, at: last.at.getTime() },
              ctx.bctx.now,
              cfg.undo.windowSeconds,
            )
          : null;
        if (!target || !last) throw new AppError("conflict", { reason: "undo_expired" });
        if (t.hallSessionId && (target === "CALLED" || target === "SERVING")) {
          // A visitor can only come back into a group session that is still running.
          const [session] = await ctx.tx.select().from(hallSessions).where(eq(hallSessions.id, t.hallSessionId));
          if (!session || (session.status !== "OPEN" && session.status !== "IN_SESSION"))
            throw new AppError("conflict", { reason: "hall_session_closed" });
        }
        const own = !isSystem(actor) && last.actorUserId === actor.auth.user.id;
        if (!own) assertPermission(actor, "tickets.reassign", t.branchId);
        if (target === "CALLED" || target === "SERVING") {
          // The agent must not have taken another ticket in the meantime beyond capacity.
          const agent = ctx.bctx.snapshot.agents.find((a) => a.id === t.servingAgentId);
          const busy = ctx.bctx.snapshot.tickets.filter(
            (x) => x.servingAgentId === t.servingAgentId && (x.status === "CALLED" || x.status === "SERVING"),
          ).length;
          if (agent && busy >= agent.maxConcurrent) throw new AppError("conflict", { reason: "agent_busy" });
        }
        row = await guardedUpdate(ctx, t, { status: target, finishedAt: null });
        await recordEvent(ctx, row, {
          type: "UNDONE",
          from: t.status,
          to: target,
          agentId: t.servingAgentId,
          payload: { undid: last.type },
        });
        break;
      }
    }

    // A visitor of a hall session: the session follows the ticket (entered, served, missed, left).
    if (t.hallSessionId && input.action !== "edit" && input.action !== "no_show") await syncHallTicket(syncOf(ctx), t, row);
    ctx.events.push({ type: "queue.updated", branchId: row.branchId, cause: input.action, ticketId: row.id });
    await rebalance(ctx);
    // A hall visitor's row changed after the action (left the session), so read it again.
    return { ticket: await toView(ctx.tx, t.hallSessionId ? await loadTicket(ctx.tx, row.organizationId, row.id) : row) };
  });
}

/** CALLED → SERVING: the visitor is with the agent (at the desk, or inside the hall). */
export async function startTicket(ctx: Ctx, t: TicketRow): Promise<TicketRow> {
  const row = await guardedUpdate(ctx, t, { status: next(t, "start"), startedAt: new Date(ctx.bctx.now) });
  await recordEvent(ctx, row, {
    type: EVENT_TYPE.start,
    from: t.status,
    to: row.status,
    agentId: t.servingAgentId,
    deskId: t.deskId,
    ...(t.hallSessionId ? { payload: { hallId: t.hallId, sessionId: t.hallSessionId } } : {}),
  });
  return row;
}

/** SERVING → COMPLETED, with the visitor's history updated. The hall session follows through `syncHallTicket`. */
export async function completeTicket(
  ctx: Ctx,
  t: TicketRow,
  input: { outcome?: string | null; notes?: string; tags?: string[] },
): Promise<TicketRow> {
  const now = new Date(ctx.bctx.now);
  const row = await guardedUpdate(ctx, t, {
    status: next(t, "complete"),
    finishedAt: now,
    outcome: input.outcome ?? null,
    notes: input.notes ?? t.notes,
    tags: input.tags ?? t.tags,
  });
  await recordEvent(ctx, row, {
    type: EVENT_TYPE.complete,
    from: t.status,
    to: row.status,
    agentId: t.servingAgentId,
    deskId: t.deskId,
    payload: { outcome: input.outcome, ...(t.hallSessionId ? { hallId: t.hallId, sessionId: t.hallSessionId } : {}) },
  });
  if (t.visitorId && t.servingAgentId) {
    await ctx.tx
      .update(visitors)
      .set({ lastAgentId: t.servingAgentId, lastVisitAt: now, visitCount: sql`${visitors.visitCount} + 1` })
      .where(eq(visitors.id, t.visitorId));
  }
  await markIdleIfFree(ctx, t.servingAgentId);
  return row;
}

export async function noShow(ctx: Ctx, t: TicketRow, cause: "manual" | "timeout"): Promise<TicketRow> {
  const cfg = ctx.bctx.configFor(t.queueId);
  const requeue = cause === "timeout" && cfg.noShow.action === "requeue_end";
  const now = new Date(ctx.bctx.now);
  const row = requeue
    ? await guardedUpdate(ctx, t, {
        status: next(t, "requeue"),
        queuedAt: now,
        servingAgentId: null,
        assignedAgentId: null,
        assignedAt: null,
        deskId: null,
        calledAt: null,
        hallId: null,
        hallSessionId: null,
      })
    : await guardedUpdate(ctx, t, { status: next(t, "no_show"), finishedAt: now });
  await recordEvent(ctx, row, {
    type: requeue ? EVENT_TYPE.requeue : EVENT_TYPE.no_show,
    from: t.status,
    to: row.status,
    agentId: t.servingAgentId,
    deskId: t.deskId,
    payload: { cause, recalls: t.recallCount },
  });
  await syncHallTicket(syncOf(ctx), t, row);
  await markIdleIfFree(ctx, t.servingAgentId);
  return row;
}

const syncOf = (ctx: Ctx) => ({ tx: ctx.tx, now: ctx.bctx.now, events: ctx.events });

export async function markIdleIfFree(ctx: Ctx, agentId: string | null) {
  if (!agentId) return;
  const [{ n }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.servingAgentId, agentId), sql`${tickets.status} in ('CALLED','SERVING')`));
  if (n === 0)
    await ctx.tx
      .update(agentProfiles)
      .set({ lastIdleSince: new Date(ctx.bctx.now) })
      .where(eq(agentProfiles.userId, agentId));
}

// ─── Timers ──────────────────────────────────────────────────────────────────

/**
 * Periodic maintenance for one branch: automatic recalls, no-show timeouts, hybrid releases and push dispatch.
 * Runs every few seconds from the job runner; safe to run concurrently (branch lock).
 */
export async function maintainBranch(branchId: string, now = clockNow()) {
  return withBranch(branchId, { system: true }, async (ctx) => {
    ctx.bctx = await loadBranchContext(ctx.tx, branchId, now);
    const called = await ctx.tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.branchId, branchId), eq(tickets.status, "CALLED")));
    // Visitors of a hall session are recalled together: one announcement per session (D62).
    const groupRecalls = new Map<string, string[]>();
    for (const t of called) {
      const cfg = ctx.bctx.configFor(t.queueId);
      const since = (now - (t.calledAt?.getTime() ?? now)) / 60_000;
      if (cfg.noShow.autoRecall && t.recallCount < cfg.noShow.maxRecalls && since >= cfg.noShow.recallAfterMinutes) {
        const row = await guardedUpdate(ctx, t, { recallCount: t.recallCount + 1, calledAt: new Date(now) });
        await recordEvent(ctx, row, {
          type: EVENT_TYPE.recall,
          from: t.status,
          to: row.status,
          agentId: t.servingAgentId,
          deskId: t.deskId,
          payload: { count: row.recallCount, auto: true },
        });
        if (row.hallSessionId) groupRecalls.set(row.hallSessionId, [...(groupRecalls.get(row.hallSessionId) ?? []), row.id]);
        else await announce(ctx, row, true);
      } else if (
        cfg.noShow.timeoutMinutes > 0 &&
        since >= cfg.noShow.timeoutMinutes &&
        (!cfg.noShow.autoRecall || t.recallCount >= cfg.noShow.maxRecalls)
      ) {
        await noShow(ctx, t, "timeout");
      }
    }
    for (const [sessionId, ticketIds] of groupRecalls) await announceHallGroup(ctx, sessionId, { recall: true, ticketIds });
    // Break line: expire offers nobody took and hand free places to the next in line.
    await offerFreedBreaks(breakCtx(ctx, { organizationId: ctx.bctx.branch.organizationId, branchId }));
    await signOutAfterShift(ctx, now);
    await rebalance(ctx);
    return { ok: true };
  });
}

/** Strict shifts: an agent whose shift ended (plus a grace period) and who has no visitor is signed out. */
async function signOutAfterShift(ctx: Ctx, now: number) {
  const { shiftMode, shiftEndGraceMinutes, agentShifts, branch, snapshot } = ctx.bctx;
  if (shiftMode !== "strict") return;
  for (const a of snapshot.agents) {
    const shift = agentShifts.get(a.id);
    if (!shift || a.status === "OFFLINE") continue;
    if (minutesSinceEnd(shift, now, branch.timezone) < Math.max(1, shiftEndGraceMinutes)) continue;
    const busy = snapshot.tickets.some((x) => x.servingAgentId === a.id && (x.status === "CALLED" || x.status === "SERVING"));
    if (!busy) await setStatusInTx(ctx, a.id, "OFFLINE");
  }
}

function breakCtx(ctx: Ctx, p: { organizationId: string; branchId: string }) {
  return { tx: ctx.tx, now: ctx.bctx.now, organizationId: p.organizationId, branchId: p.branchId, events: ctx.events };
}

// ─── Views ───────────────────────────────────────────────────────────────────

export type TicketView = {
  id: string;
  displayNumber: string;
  status: TicketStatus;
  branchId: string;
  queueId: string;
  reasonId: string;
  priorityKey: string | null;
  language: string;
  assignedAgentId: string | null;
  servingAgentId: string | null;
  deskId: string | null;
  /** The hall and group session the visitor is in (D62), if any. */
  hallId: string | null;
  hallSessionId: string | null;
  arrivedAt: string;
  queuedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  recallCount: number;
  notes: string | null;
  intake: Record<string, string>;
  publicToken: string;
  visitor: {
    id: string;
    name: string | null;
    phone: string | null;
    company: string | null;
    /** Completed visits before this one. */
    visitCount: number;
    lastVisitAt: string | null;
    returning: boolean;
  } | null;
  appointmentId: string | null;
};

export type VisitorRow = typeof visitors.$inferSelect;

/** Maps a ticket (and its visitor) to the API shape. Pure; callers batch-load visitors. */
export function viewOf(t: TicketRow, v: VisitorRow | null | undefined): TicketView {
  return {
    id: t.id,
    displayNumber: t.displayNumber,
    status: t.status,
    branchId: t.branchId,
    queueId: t.queueId,
    reasonId: t.reasonId,
    priorityKey: t.priorityKey,
    language: t.language,
    assignedAgentId: t.assignedAgentId,
    servingAgentId: t.servingAgentId,
    deskId: t.deskId,
    hallId: t.hallId,
    hallSessionId: t.hallSessionId,
    arrivedAt: t.arrivedAt.toISOString(),
    queuedAt: t.queuedAt.toISOString(),
    calledAt: t.calledAt?.toISOString() ?? null,
    startedAt: t.startedAt?.toISOString() ?? null,
    finishedAt: t.finishedAt?.toISOString() ?? null,
    recallCount: t.recallCount,
    notes: t.notes,
    intake: t.intake,
    publicToken: t.publicToken,
    visitor: v
      ? {
          id: v.id,
          name: v.name,
          phone: v.phone,
          company: v.company,
          visitCount: v.visitCount,
          lastVisitAt: v.lastVisitAt?.toISOString() ?? null,
          returning: v.visitCount > 0,
        }
      : null,
    appointmentId: t.appointmentId,
  };
}

export async function toView(tx: DbOrTx, t: TicketRow): Promise<TicketView> {
  const [v] = t.visitorId ? await tx.select().from(visitors).where(eq(visitors.id, t.visitorId)) : [];
  return viewOf(t, v);
}
