import { and, desc, eq, inArray, isNotNull, lt, gte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, tickets, visitReasons } from "@/db/schema";
import type { Actor } from "../admin/actor";
import { now as clockNow } from "../clock";

export const activityQuery = z.object({
  /** all = everything, audit = things I changed, tickets = visitors I served or tickets I issued. */
  type: z.enum(["all", "audit", "tickets"]).default("all"),
  days: z.number().int().min(1).max(365).default(30),
  /** Cursor: return only entries older than this instant (the `nextBefore` of the previous page). */
  before: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type ActivityQuery = z.infer<typeof activityQuery>;

export type ActivityItem =
  | { kind: "audit"; id: string; at: string; action: string; entityType: string; entityId: string | null }
  | {
      kind: "ticket";
      id: string;
      at: string;
      /** served = I served the visitor; issued = I issued the ticket. */
      role: "served" | "issued";
      displayNumber: string;
      reason: Record<string, string>;
      status: string;
      outcome: string | null;
      /** Minutes from start to finish (served only). */
      serviceMin: number | null;
      /** Minutes from arrival to the first call. */
      waitMin: number | null;
    };

const iso = (d: Date) => d.toISOString();

/** The signed-in user's own recent actions (audit entries where they are the actor) and tickets they served or issued. */
export async function myActivity(actor: Actor, q: ActivityQuery): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
  const me = actor.auth.user.id;
  const now = clockNow();
  const from = new Date(now - q.days * 86_400_000);
  const before = q.before ? new Date(q.before) : null;
  const take = q.limit + 1;
  const items: ActivityItem[] = [];

  if (q.type !== "tickets") {
    const rows = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, me), gte(auditLogs.at, from), before ? lt(auditLogs.at, before) : undefined))
      .orderBy(desc(auditLogs.at))
      .limit(take);
    for (const r of rows)
      items.push({ kind: "audit", id: r.id, at: iso(r.at), action: r.action, entityType: r.entityType, entityId: r.entityId });
  }

  if (q.type !== "audit") {
    const firstCalled = sql<Date | null>`(select min(e.at) from ticket_events e where e.ticket_id = ${tickets.id} and e.type = 'CALLED')`;
    const base = {
      id: tickets.id,
      displayNumber: tickets.displayNumber,
      status: tickets.status,
      outcome: tickets.outcome,
      arrivedAt: tickets.arrivedAt,
      startedAt: tickets.startedAt,
      finishedAt: tickets.finishedAt,
      reason: visitReasons.name,
      firstCalledAt: firstCalled,
    };
    const run = (cond: SQL | undefined, at: typeof tickets.finishedAt | typeof tickets.arrivedAt) =>
      db()
        .select(base)
        .from(tickets)
        .innerJoin(visitReasons, eq(visitReasons.id, tickets.reasonId))
        .where(and(cond, gte(at, from), before ? lt(at, before) : undefined))
        .orderBy(desc(at))
        .limit(take);
    const [served, issued] = await Promise.all([
      run(
        and(eq(tickets.servingAgentId, me), inArray(tickets.status, ["COMPLETED", "NO_SHOW"]), isNotNull(tickets.finishedAt)),
        tickets.finishedAt,
      ),
      run(eq(tickets.issuedByUserId, me), tickets.arrivedAt),
    ]);
    const item = (r: (typeof served)[number], role: "served" | "issued"): ActivityItem => {
      const first = r.firstCalledAt ? new Date(r.firstCalledAt).getTime() : null;
      return {
        kind: "ticket",
        id: `${role}:${r.id}`,
        at: iso(role === "served" ? r.finishedAt! : r.arrivedAt),
        role,
        displayNumber: r.displayNumber,
        reason: r.reason,
        status: r.status,
        outcome: r.outcome,
        serviceMin:
          role === "served" && r.startedAt && r.finishedAt
            ? Math.round((Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()) / 60_000) * 10) / 10
            : null,
        waitMin: first === null ? null : Math.round((Math.max(0, first - r.arrivedAt.getTime()) / 60_000) * 10) / 10,
      };
    };
    for (const r of served) items.push(item(r, "served"));
    for (const r of issued) items.push(item(r, "issued"));
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = items.slice(0, q.limit);
  return { items: page, nextBefore: items.length > q.limit ? page[page.length - 1].at : null };
}
