import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { hallSessions, hallSessionTickets, tickets } from "@/db/schema";
import { orderTickets } from "@/domain/distribution/ordering";
import { planHallBatch } from "@/domain/halls/plan";
import { ACTIVE_MEMBER, LIVE_SESSION, type HallTicketStatus } from "@/domain/halls/state";
import { can } from "@/domain/rbac/permissions";
import { EVENT_TYPE } from "@/domain/tickets/state-machine";
import { uuid } from "@/domain/validation";
import { AppError } from "../http/errors";
import { announceHallGroup } from "./announce";
import { refreshSession, syncHallTicket } from "./sync";
import {
  agentProfile,
  assertHallSignIn,
  completeTicket,
  guardedUpdate,
  isSystem,
  loadTicket,
  markIdleIfFree,
  next,
  noShow,
  rebalance,
  recordEvent,
  requireAgent,
  setStatusInTx,
  startTicket,
  withBranch,
  type Ctx,
  type QueueActor,
  type TicketRow,
} from "../queue/tickets";
import { hallSessionView, type HallSessionView } from "./views";

type SessionRow = typeof hallSessions.$inferSelect;

export const callGroupInput = z.object({
  /** The hall to host; default is the one the agent is signed in to, or the one assigned to their profile. */
  hallId: uuid.nullable().optional(),
  /** How many visitors to call; default as many as the hall and the settings allow. */
  size: z.number().int().min(1).max(200).nullable().optional(),
  /** Call this reason's visitors (same-reason mode); default the one at the head of the line. */
  reasonId: uuid.nullable().optional(),
});

export const sessionActionInput = z.discriminatedUnion("action", [
  /** Visitors who came in; no ids = every visitor still at the door. */
  z.object({ action: z.literal("enter"), ticketIds: z.array(uuid).max(200).optional() }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("release"), ticketId: uuid }),
  z.object({ action: z.literal("no_show"), ticketId: uuid }),
  z.object({ action: z.literal("recall") }),
  z.object({ action: z.literal("top_up"), size: z.number().int().min(1).max(200).nullable().optional() }),
  z.object({
    action: z.literal("close"),
    /** Outcome for every visitor served, unless `outcomes` names one. */
    outcome: z.string().max(60).nullable().optional(),
    outcomes: z.record(uuid, z.string().max(60)).optional(),
  }),
  z.object({ action: z.literal("cancel") }),
]);
export type SessionActionInput = z.infer<typeof sessionActionInput>;

export type CallGroupResult = {
  session: HallSessionView | null;
  /** false when a session was already open (a second click, or a reload): nothing new was called. */
  created: boolean;
  /** Why nobody was called. */
  reason: "empty" | "below_min" | "full" | null;
  /** Visitors waiting for this hall (before the minimum / capacity). */
  available: number;
};

function assertHost(actor: QueueActor, s: SessionRow, branchId: string) {
  if (isSystem(actor)) return;
  if (s.hostAgentId === actor.auth.user.id) return;
  if (can(actor.auth.grants, "tickets.reassign", branchId)) return;
  throw new AppError("forbidden", { reason: "not_your_session" });
}

async function liveSessionOf(ctx: Ctx, where: Parameters<typeof and>[0]): Promise<SessionRow | undefined> {
  const [s] = await ctx.tx
    .select()
    .from(hallSessions)
    .where(and(where, inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
  return s;
}

async function loadSession(ctx: Ctx, id: string, organizationId: string): Promise<SessionRow> {
  const [s] = await ctx.tx
    .select()
    .from(hallSessions)
    .where(and(eq(hallSessions.id, id), eq(hallSessions.organizationId, organizationId)));
  if (!s) throw new AppError("not_found");
  return s;
}

async function members(ctx: Ctx, sessionId: string) {
  return ctx.tx
    .select({ m: hallSessionTickets, t: tickets })
    .from(hallSessionTickets)
    .innerJoin(tickets, eq(tickets.id, hallSessionTickets.ticketId))
    .where(eq(hallSessionTickets.sessionId, sessionId))
    .orderBy(asc(tickets.queuedAt), asc(tickets.number));
}

const syncOf = (ctx: Ctx) => ({ tx: ctx.tx, now: ctx.bctx.now, events: ctx.events });

/** WAITING → CALLED for one visitor of a group (to the hall, not to a desk). */
async function callIntoHall(ctx: Ctx, t: TicketRow, s: SessionRow, hostId: string) {
  const now = new Date(ctx.bctx.now);
  const row = await guardedUpdate(ctx, t, {
    status: next(t, "call"),
    servingAgentId: hostId,
    assignedAgentId: hostId,
    assignedAt: now,
    deskId: null,
    hallId: s.hallId,
    hallSessionId: s.id,
    calledAt: now,
    recallCount: 0,
  });
  await recordEvent(ctx, row, {
    type: "CALLED",
    from: t.status,
    to: row.status,
    agentId: hostId,
    payload: { hallId: s.hallId, sessionId: s.id },
  });
  // A visitor sent back earlier and called into the same session again reuses their row.
  await ctx.tx
    .insert(hallSessionTickets)
    .values({ sessionId: s.id, ticketId: t.id, status: "CALLED", calledAt: now })
    .onConflictDoUpdate({
      target: [hallSessionTickets.sessionId, hallSessionTickets.ticketId],
      set: { status: "CALLED", calledAt: now, enteredAt: null, finishedAt: null, outcome: null },
    });
  return row;
}

/** Waiting visitors of the hall's reasons, in the order the desk queue would serve them. */
function waitingFor(ctx: Ctx, hallId: string, reasonId?: string | null) {
  const { snapshot: snap, halls: hallList, hallAccepts } = ctx.bctx;
  const hall = hallList.find((h) => h.id === hallId);
  if (!hall) throw new AppError("not_found");
  const mine = snap.tickets.filter(
    (t) => t.status === "WAITING" && t.hall && hallAccepts(hall, t.reasonId) && (!reasonId || t.reasonId === reasonId),
  );
  return { hall, ordered: orderTickets(mine, snap.now, snap.configFor, snap.reasons, snap.priorities) };
}

/**
 * Calls the next group into the hall (D62). The host's hall is the one they are signed in to; pressing the button also
 * signs them in. A second press while a session is open returns that session (nothing more is called).
 */
export async function callGroup(actor: QueueActor, input: z.infer<typeof callGroupInput>): Promise<CallGroupResult> {
  const agent = requireAgent(actor);
  const userId = agent.auth.user.id;
  const p = await agentProfile(db(), userId);
  return withBranch(p.branchId, actor, async (ctx) => {
    const { hallSettings: cfg } = ctx.bctx;
    if (!cfg.enabled) throw new AppError("conflict", { reason: "halls_disabled" });
    const hallId = input.hallId ?? p.currentHallId ?? p.defaultHallId;
    if (!hallId) throw new AppError("validation", { reason: "hall_required" });
    const hall = ctx.bctx.halls.find((h) => h.id === hallId);
    if (!hall) throw new AppError("validation", { field: "hallId" });

    // Idempotent: the host already has a session open (double click, second tab).
    const mine = await liveSessionOf(ctx, eq(hallSessions.hostAgentId, userId));
    if (mine) {
      if (mine.hallId !== hallId) throw new AppError("conflict", { reason: "host_busy" });
      return { session: await hallSessionView(ctx.tx, mine.id), created: false, reason: null, available: 0 };
    }
    if (await liveSessionOf(ctx, eq(hallSessions.hallId, hallId))) throw new AppError("conflict", { reason: "hall_busy" });
    const deskOpen = ctx.bctx.snapshot.tickets.some(
      (t) => t.servingAgentId === userId && (t.status === "CALLED" || t.status === "SERVING"),
    );
    if (deskOpen) throw new AppError("conflict", { reason: "desk_tickets_open" });

    // Calling a group means the host is ready: sign in to the hall (one host per hall).
    if (p.currentHallId !== hallId || p.status !== "AVAILABLE") {
      await assertHallSignIn(ctx, userId, p, { status: "AVAILABLE", hallId });
      await setStatusInTx(ctx, userId, "AVAILABLE", { hallId });
    }

    const { ordered } = waitingFor(ctx, hallId, cfg.groupMode === "same_reason" ? input.reasonId : null);
    const plan = planHallBatch({
      waiting: ordered,
      capacity: hall.capacity,
      minGroup: cfg.minGroup,
      maxGroup: cfg.maxGroup,
      groupMode: cfg.groupMode,
      reasonId: input.reasonId,
      size: input.size,
    });
    if (!plan.ticketIds.length) {
      return { session: null, created: false, reason: plan.shortfall === "none" ? "empty" : plan.shortfall, available: plan.available };
    }

    const now = new Date(ctx.bctx.now);
    const [session] = await ctx.tx
      .insert(hallSessions)
      .values({
        organizationId: ctx.bctx.branch.organizationId,
        branchId: ctx.bctx.branch.id,
        hallId,
        hostAgentId: userId,
        status: "OPEN",
        capacity: hall.capacity,
        reasonId: cfg.groupMode === "same_reason" ? plan.reasonId : null,
        calledAt: now,
      })
      .returning();
    for (const id of plan.ticketIds) {
      const t = await loadTicket(ctx.tx, ctx.bctx.branch.organizationId, id);
      await callIntoHall(ctx, t, session, userId);
    }
    await announceHallGroup(ctx, session.id, { recall: false });
    ctx.events.push({ type: "queue.updated", branchId: session.branchId, cause: "hall_called" });
    await rebalance(ctx);
    return { session: await hallSessionView(ctx.tx, session.id), created: true, reason: null, available: plan.available };
  });
}

/** Everything a host does inside a session. Each action is idempotent: repeating it returns the session as it is. */
export async function sessionAction(actor: QueueActor, sessionId: string, input: SessionActionInput) {
  const orgId = isSystem(actor) ? undefined : actor.auth.user.organizationId;
  const [head] = await db()
    .select({ branchId: hallSessions.branchId, organizationId: hallSessions.organizationId })
    .from(hallSessions)
    .where(orgId ? and(eq(hallSessions.id, sessionId), eq(hallSessions.organizationId, orgId)) : eq(hallSessions.id, sessionId));
  if (!head) throw new AppError("not_found");

  return withBranch(head.branchId, actor, async (ctx) => {
    const s = await loadSession(ctx, sessionId, head.organizationId);
    assertHost(actor, s, s.branchId);
    const view = async () => ({ session: await hallSessionView(ctx.tx, sessionId) });
    const live = LIVE_SESSION.has(s.status);
    const list = await members(ctx, sessionId);
    const active = list.filter((x) => ACTIVE_MEMBER.has(x.m.status as HallTicketStatus));
    const cfg = ctx.bctx.hallSettings;
    const now = new Date(ctx.bctx.now);

    switch (input.action) {
      case "enter": {
        if (!live) return view();
        const wanted = input.ticketIds ? new Set(input.ticketIds) : null;
        if (wanted) for (const id of wanted) if (!list.some((x) => x.t.id === id)) throw new AppError("validation", { field: "ticketIds" });
        for (const { m, t } of active) {
          if (m.status !== "CALLED" || (wanted && !wanted.has(t.id))) continue;
          const row = await startTicket(ctx, t);
          await syncHallTicket(syncOf(ctx), t, row);
        }
        break;
      }
      case "start": {
        if (s.status === "IN_SESSION" || !live) return view();
        if (!active.some((x) => x.m.status === "ENTERED")) throw new AppError("conflict", { reason: "nobody_entered" });
        await ctx.tx.update(hallSessions).set({ status: "IN_SESSION", startedAt: s.startedAt ?? now }).where(eq(hallSessions.id, s.id));
        break;
      }
      case "release": {
        const target = list.find((x) => x.t.id === input.ticketId);
        if (!target) throw new AppError("validation", { field: "ticketId" });
        if (!live || !ACTIVE_MEMBER.has(target.m.status as HallTicketStatus)) return view();
        await releaseToQueue(ctx, target.t);
        break;
      }
      case "no_show": {
        const target = list.find((x) => x.t.id === input.ticketId);
        if (!target) throw new AppError("validation", { field: "ticketId" });
        if (!live || target.m.status !== "CALLED") return view();
        await noShow(ctx, target.t, "manual");
        break;
      }
      case "recall": {
        if (!live) return view();
        const calledIds: string[] = [];
        for (const { m, t } of active) {
          if (m.status !== "CALLED") continue;
          const row = await guardedUpdate(ctx, t, { recallCount: t.recallCount + 1, calledAt: now });
          await recordEvent(ctx, row, {
            type: EVENT_TYPE.recall,
            from: t.status,
            to: row.status,
            agentId: t.servingAgentId,
            payload: { count: row.recallCount, hallId: s.hallId, sessionId: s.id },
          });
          calledIds.push(t.id);
        }
        if (calledIds.length) await announceHallGroup(ctx, s.id, { recall: true, ticketIds: calledIds });
        break;
      }
      case "top_up": {
        if (!live) return view();
        if (!cfg.allowTopUp) throw new AppError("conflict", { reason: "top_up_off" });
        if (s.status !== "OPEN") throw new AppError("conflict", { reason: "session_started" });
        const hall = ctx.bctx.halls.find((h) => h.id === s.hallId);
        if (!hall) throw new AppError("not_found");
        const { ordered } = waitingFor(ctx, s.hallId, cfg.groupMode === "same_reason" ? s.reasonId : null);
        const plan = planHallBatch({
          waiting: ordered,
          capacity: s.capacity,
          minGroup: cfg.minGroup,
          maxGroup: cfg.maxGroup,
          groupMode: cfg.groupMode,
          reasonId: cfg.groupMode === "same_reason" ? s.reasonId : null,
          occupied: active.length,
          size: input.size,
        });
        const added: string[] = [];
        for (const id of plan.ticketIds) {
          const t = await loadTicket(ctx.tx, s.organizationId, id);
          await callIntoHall(ctx, t, s, s.hostAgentId);
          added.push(id);
        }
        if (added.length) await announceHallGroup(ctx, s.id, { recall: false, ticketIds: added });
        break;
      }
      case "close": {
        if (!live) return view();
        if (!active.some((x) => x.m.status === "ENTERED")) throw new AppError("conflict", { reason: "nobody_entered" });
        if (!s.startedAt)
          await ctx.tx.update(hallSessions).set({ startedAt: now, status: "IN_SESSION" }).where(eq(hallSessions.id, s.id));
        for (const { m, t } of active) {
          if (m.status === "ENTERED") {
            const row = await completeTicket(ctx, t, { outcome: input.outcomes?.[t.id] ?? input.outcome ?? null });
            await syncHallTicket(syncOf(ctx), t, row);
          } else {
            // Called but never came in.
            await noShow(ctx, t, "manual");
          }
        }
        await ctx.tx
          .update(hallSessions)
          .set({ status: "CLOSED", closedAt: now, outcome: input.outcome ?? null })
          .where(eq(hallSessions.id, s.id));
        break;
      }
      case "cancel": {
        if (!live) return view();
        if (active.some((x) => x.m.status === "ENTERED")) throw new AppError("conflict", { reason: "has_entered" });
        for (const { t } of active) await releaseToQueue(ctx, t);
        // Everyone is back in the queue: the session never took place.
        await ctx.tx
          .update(hallSessions)
          .set({ status: "CANCELLED", closedAt: now })
          .where(and(eq(hallSessions.id, s.id), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])));
        break;
      }
    }
    await refreshSession(syncOf(ctx), s.id, s.organizationId, s.branchId);
    ctx.events.push({ type: "queue.updated", branchId: s.branchId, cause: `hall_${input.action}` });
    await rebalance(ctx);
    return view();
  });
}

/**
 * A visitor goes back to the queue at their original place (D62): their queue time is untouched, so the ordering puts
 * them exactly where they were. A visitor already inside is released with the "transfer" action of the state machine.
 */
async function releaseToQueue(ctx: Ctx, t: TicketRow) {
  const action = t.status === "SERVING" ? "transfer" : "requeue";
  const row = await guardedUpdate(ctx, t, {
    status: next(t, action),
    servingAgentId: null,
    assignedAgentId: null,
    assignedAt: null,
    deskId: null,
    calledAt: null,
    startedAt: null,
    recallCount: 0,
    hallId: null,
    hallSessionId: null,
  });
  await recordEvent(ctx, row, {
    type: "HALL_RELEASED",
    from: t.status,
    to: row.status,
    agentId: t.servingAgentId,
    payload: { hallId: t.hallId, sessionId: t.hallSessionId },
  });
  await syncHallTicket(syncOf(ctx), t, row);
  await markIdleIfFree(ctx, t.servingAgentId);
}
