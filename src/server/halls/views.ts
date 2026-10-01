import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { hallSessions, hallSessionTickets, halls, tickets, visitors } from "@/db/schema";
import { orderTickets } from "@/domain/distribution/ordering";
import { planHallBatch, seatsLeft } from "@/domain/halls/plan";
import { ACTIVE_MEMBER, type HallSessionStatus, type HallTicketStatus } from "@/domain/halls/state";
import type { BranchContext } from "../queue/snapshot";
import { viewOf, type TicketView } from "../queue/tickets";

export type HallSessionView = {
  id: string;
  status: HallSessionStatus;
  hallId: string;
  hallNumber: string;
  hallName: Record<string, string>;
  hostAgentId: string;
  capacity: number;
  reasonId: string | null;
  calledAt: string;
  startedAt: string | null;
  closedAt: string | null;
  /** Visitors called or inside (they use seats). */
  occupied: number;
  tickets: {
    status: HallTicketStatus;
    enteredAt: string | null;
    finishedAt: string | null;
    outcome: string | null;
    ticket: TicketView;
  }[];
};

/** A session with its visitors (and their details: only the host or a supervisor ever receives this). */
export async function hallSessionView(tx: DbOrTx, sessionId: string): Promise<HallSessionView | null> {
  const [row] = await tx
    .select({ s: hallSessions, h: halls })
    .from(hallSessions)
    .innerJoin(halls, eq(halls.id, hallSessions.hallId))
    .where(eq(hallSessions.id, sessionId));
  if (!row) return null;
  const members = await tx
    .select({ m: hallSessionTickets, t: tickets })
    .from(hallSessionTickets)
    .innerJoin(tickets, eq(tickets.id, hallSessionTickets.ticketId))
    .where(eq(hallSessionTickets.sessionId, sessionId))
    .orderBy(asc(tickets.queuedAt), asc(tickets.number));
  const ids = [...new Set(members.map((x) => x.t.visitorId).filter((x): x is string => !!x))];
  const vis = ids.length ? await tx.select().from(visitors).where(inArray(visitors.id, ids)) : [];
  const byId = new Map(vis.map((v) => [v.id, v]));
  return {
    id: row.s.id,
    status: row.s.status,
    hallId: row.h.id,
    hallNumber: row.h.number,
    hallName: row.h.name,
    hostAgentId: row.s.hostAgentId,
    capacity: row.s.capacity,
    reasonId: row.s.reasonId,
    calledAt: row.s.calledAt.toISOString(),
    startedAt: row.s.startedAt?.toISOString() ?? null,
    closedAt: row.s.closedAt?.toISOString() ?? null,
    occupied: members.filter((x) => ACTIVE_MEMBER.has(x.m.status)).length,
    tickets: members
      .filter((x) => x.m.status !== "RELEASED")
      .map((x) => ({
        status: x.m.status,
        enteredAt: x.m.enteredAt?.toISOString() ?? null,
        finishedAt: x.m.finishedAt?.toISOString() ?? null,
        outcome: x.m.outcome,
        ticket: viewOf(x.t, byId.get(x.t.visitorId ?? "")),
      })),
  };
}

/**
 * The hall part of the agent workspace (D62): the halls of the branch, the one the agent hosts, the visitors that
 * could be called right now and the live session. `null` when the feature is off in this branch.
 */
export async function hallConsole(
  tx: DbOrTx,
  bctx: BranchContext,
  profile: { userId: string; currentHallId: string | null; defaultHallId: string | null },
) {
  const cfg = bctx.hallSettings;
  if (!cfg.enabled) return null;
  const hallId = profile.currentHallId ?? profile.defaultHallId;
  const hall = bctx.halls.find((h) => h.id === hallId) ?? null;
  const [live] = await tx
    .select({ id: hallSessions.id })
    .from(hallSessions)
    .where(and(eq(hallSessions.hostAgentId, profile.userId), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])))
    .orderBy(desc(hallSessions.calledAt))
    .limit(1);
  const session = live ? await hallSessionView(tx, live.id) : null;
  const target = session ? (bctx.halls.find((h) => h.id === session.hallId) ?? hall) : hall;

  let waiting = 0;
  let callable = 0;
  let max = 0;
  if (target) {
    const s = bctx.snapshot;
    const mine = s.tickets.filter((t) => t.status === "WAITING" && t.hall && bctx.hallAccepts(target, t.reasonId));
    waiting = mine.length;
    const ordered = orderTickets(mine, s.now, s.configFor, s.reasons, s.priorities);
    const occupied = session?.status === "OPEN" ? session.occupied : 0;
    const plan = planHallBatch({
      waiting: ordered,
      capacity: target.capacity,
      minGroup: cfg.minGroup,
      maxGroup: cfg.maxGroup,
      groupMode: cfg.groupMode,
      reasonId: session && cfg.groupMode === "same_reason" ? session.reasonId : null,
      occupied,
    });
    callable = plan.ticketIds.length;
    max = seatsLeft(target.capacity, cfg.maxGroup, occupied);
  }
  return {
    settings: {
      groupMode: cfg.groupMode,
      minGroup: cfg.minGroup,
      maxGroup: cfg.maxGroup,
      allowTopUp: cfg.allowTopUp,
      autoStartWhenAllEntered: cfg.autoStartWhenAllEntered,
    },
    halls: bctx.halls.map((h) => ({
      id: h.id,
      number: h.number,
      name: h.name,
      capacity: h.capacity,
      zone: h.zone,
      hostAgentId: h.hostAgentId,
    })),
    hall: target ? { id: target.id, number: target.number, name: target.name, capacity: target.capacity } : null,
    waiting,
    callable,
    /** The largest group the next call can take (capacity, maximum group and seats already used). */
    maxCall: max,
    session,
  };
}

export type HallConsole = NonNullable<Awaited<ReturnType<typeof hallConsole>>>;
