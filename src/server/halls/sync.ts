import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { hallSessions, hallSessionTickets, tickets } from "@/db/schema";
import { memberStatusFor, nextSessionStatus } from "@/domain/halls/state";
import { getSetting } from "../settings/service";
import type { QueueEvent } from "../queue/publish";

type TicketRow = typeof tickets.$inferSelect;
export type SyncCtx = { tx: Tx; now: number; events: QueueEvent[] };

/**
 * Keeps the hall session in step with a ticket that is part of it (D62). Every ticket action goes through the one
 * state machine; afterwards this records what it means for the session: the visitor entered, was served, missed the
 * call, or left (back to the queue / on hold / cancelled). When the last active visitor is gone the session closes by
 * itself; when everybody has entered it starts (if the branch setting says so).
 *
 * No other module imports the ticket service, so the ticket service can call this without a cycle.
 */
export async function syncHallTicket(ctx: SyncCtx, before: TicketRow, after: TicketRow): Promise<void> {
  const sessionId = before.hallSessionId;
  if (!sessionId) return;
  const { tx } = ctx;
  const now = new Date(ctx.now);
  const status = memberStatusFor(after.status);

  await tx
    .update(hallSessionTickets)
    .set({
      status,
      ...(status === "ENTERED" ? { enteredAt: now } : {}),
      ...(status === "DONE" || status === "NO_SHOW" || status === "RELEASED" ? { finishedAt: now } : {}),
      ...(status === "DONE" ? { outcome: after.outcome } : {}),
    })
    .where(and(eq(hallSessionTickets.sessionId, sessionId), eq(hallSessionTickets.ticketId, before.id)));

  if (status === "RELEASED") {
    // Back in the queue (or held / cancelled): the ticket is no longer part of the hall session.
    await tx.update(tickets).set({ hallId: null, hallSessionId: null }).where(eq(tickets.id, before.id));
  }
  await refreshSession(ctx, sessionId, before.organizationId, before.branchId);
}

/** Recomputes the status of a session from its members and stores the change (start / close). */
export async function refreshSession(ctx: SyncCtx, sessionId: string, organizationId: string, branchId: string) {
  const { tx } = ctx;
  const [session] = await tx.select().from(hallSessions).where(eq(hallSessions.id, sessionId));
  if (!session) return null;
  const members = await tx.select().from(hallSessionTickets).where(eq(hallSessionTickets.sessionId, sessionId));
  const settings = await getSetting(organizationId, "halls", branchId, tx);
  const next = nextSessionStatus(
    { status: session.status, started: !!session.startedAt },
    members,
    settings.autoStartWhenAllEntered,
  );
  if (next === session.status) return session;
  const now = new Date(ctx.now);
  const [row] = await tx
    .update(hallSessions)
    .set({
      status: next,
      ...(next === "IN_SESSION" ? { startedAt: session.startedAt ?? now } : {}),
      ...(next === "CLOSED" || next === "CANCELLED" ? { closedAt: now } : {}),
    })
    .where(eq(hallSessions.id, sessionId))
    .returning();
  ctx.events.push({ type: "queue.updated", branchId, cause: `hall_${next.toLowerCase()}` });
  return row;
}
