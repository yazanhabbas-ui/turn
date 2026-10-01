import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { hallSessions, hallSessionTickets, halls, tickets } from "@/db/schema";
import type { QueueEvent } from "../queue/publish";

/**
 * Announces visitors of a hall session (D62): one `ticket.called` per ticket, carrying the hall, and ONE grouped
 * `hall.called` for the whole group so the screens and the voice announce the group once.
 *
 * `ticketIds` limits the call to some visitors (a recall of those who have not entered; one visitor topped up);
 * by default every visitor still waiting at the door (status CALLED) is announced.
 */
export async function announceHallGroup(
  ctx: { tx: Tx; events: QueueEvent[] },
  sessionId: string,
  opts: { recall: boolean; ticketIds?: string[] },
): Promise<void> {
  const [session] = await ctx.tx.select().from(hallSessions).where(eq(hallSessions.id, sessionId));
  if (!session) return;
  const [hall] = await ctx.tx.select().from(halls).where(eq(halls.id, session.hallId));
  if (!hall) return;
  const members = await ctx.tx
    .select({ t: tickets })
    .from(hallSessionTickets)
    .innerJoin(tickets, eq(tickets.id, hallSessionTickets.ticketId))
    .where(
      and(
        eq(hallSessionTickets.sessionId, sessionId),
        eq(hallSessionTickets.status, "CALLED"),
        opts.ticketIds ? inArray(hallSessionTickets.ticketId, opts.ticketIds) : undefined,
      ),
    )
    .orderBy(asc(tickets.queuedAt), asc(tickets.number));
  if (!members.length) return;
  for (const { t } of members) {
    ctx.events.push({
      type: "ticket.called",
      branchId: t.branchId,
      ticketId: t.id,
      displayNumber: t.displayNumber,
      deskId: null,
      deskNumber: null,
      agentId: session.hostAgentId,
      reasonId: t.reasonId,
      language: t.language,
      recall: opts.recall,
      hallId: hall.id,
      hallNumber: hall.number,
    });
  }
  ctx.events.push({
    type: "hall.called",
    branchId: session.branchId,
    hallId: hall.id,
    hallNumber: hall.number,
    hallName: hall.name,
    sessionId,
    agentId: session.hostAgentId,
    tickets: members.map(({ t }) => ({
      ticketId: t.id,
      displayNumber: t.displayNumber,
      reasonId: t.reasonId,
      language: t.language,
    })),
    recall: opts.recall,
  });
}
