import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { HallTicketStatus } from "@/domain/halls/state";
import type { HallSessionFact } from "@/domain/reports/halls";

/**
 * The group sessions an agent hosted and closed in [startMs, endMs), with the status of every visitor of each
 * (D62). Feeds the "sessions hosted" and "visitors received in halls" numbers of the agent's own report and progress.
 */
export async function hostedSessionFacts(agentId: string, startMs: number, endMs: number): Promise<HallSessionFact[]> {
  const rows = await db().execute<{
    id: string;
    hall_id: string;
    branch_id: string;
    status: HallSessionFact["status"];
    capacity: number;
    called_at: Date;
    started_at: Date | null;
    closed_at: Date | null;
    members: HallTicketStatus[] | null;
  }>(sql`
    select s.id, s.hall_id, s.branch_id, s.status, s.capacity, s.called_at, s.started_at, s.closed_at,
      (select array_agg(m.status::text) from hall_session_tickets m where m.session_id = s.id) as members
    from hall_sessions s
    where s.host_agent_id = ${agentId} and s.status = 'CLOSED'
      and s.closed_at >= ${new Date(startMs)} and s.closed_at < ${new Date(endMs)}`);
  return rows.rows.map((r) => ({
    sessionId: r.id,
    hallId: r.hall_id,
    branchId: r.branch_id,
    hostAgentId: agentId,
    status: r.status,
    capacity: r.capacity,
    calledAt: new Date(r.called_at).getTime(),
    startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
    closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
    members: r.members ?? [],
  }));
}
