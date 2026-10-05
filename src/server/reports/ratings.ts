import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { can } from "@/domain/rbac/permissions";
import { zonedToUtc } from "@/domain/schedule/time";
import { isoDate, uuid } from "@/domain/validation";
import { z } from "zod";
import type { Actor } from "../admin/actor";
import { orgOf } from "../admin/actor";
import { AppError } from "../http/errors";
import { reportBranches } from "./service";

const MAX_DAYS = 92;
const LIMIT = 500;

export const ratingsQuery = z.object({
  from: isoDate,
  to: isoDate,
  branchId: uuid.optional(),
  agentId: uuid.optional(),
});
export type RatingsQuery = z.infer<typeof ratingsQuery>;

export type VisitorRating = {
  id: string;
  at: string;
  displayNumber: string;
  score: number;
  comment: string | null;
  /** How the ticket was issued: reception, kiosk, … */
  source: string;
  visitor: { name: string | null; phoneMasked: string | null; phone: string | null };
  desk: { number: string; name: Record<string, string> } | null;
  agent: { id: string; name: Record<string, string> } | null;
};

/**
 * Visitor ratings of a period with who gave them (the name and phone the reception or kiosk recorded), the desk,
 * the agent, the score and the comment. Phone numbers are masked unless the viewer may see personal data.
 */
export async function visitorRatings(actor: Actor, q: RatingsQuery) {
  const bs = await reportBranches(actor, "reports.view", q.branchId);
  const tz = bs[0].timezone;
  const fromMs = zonedToUtc(q.from, "00:00", tz);
  const toMs = zonedToUtc(q.to, "23:59", tz) + 60_000;
  if (toMs <= fromMs || toMs - fromMs > MAX_DAYS * 86_400_000 + 60_000) {
    throw new AppError("validation", { field: "to", reason: "invalid_range" });
  }
  const fullPhone = can(actor.auth.grants, "visitors.privacy");

  const rows = await db().execute<{
    id: string;
    at: Date;
    display_number: string;
    score: number;
    comment: string | null;
    source: string;
    visitor_name: string | null;
    visitor_phone: string | null;
    anonymized_at: Date | null;
    desk_number: string | null;
    desk_name: Record<string, string> | null;
    agent_id: string | null;
    agent_name: Record<string, string> | null;
  }>(sql`
    select c.id, c.at, t.display_number, c.score, c.comment, t.source,
      v.name as visitor_name, v.phone as visitor_phone, v.anonymized_at,
      d.number as desk_number, d.name as desk_name,
      c.agent_id, u.display_name as agent_name
    from csat_responses c
    join tickets t on t.id = c.ticket_id
    left join visitors v on v.id = t.visitor_id
    left join desks d on d.id = t.desk_id
    left join users u on u.id = c.agent_id
    where c.organization_id = ${orgOf(actor)}
      and c.branch_id in (${sql.join(
        bs.map((b) => sql`${b.id}`),
        sql`, `,
      )})
      and c.at >= ${new Date(fromMs)} and c.at < ${new Date(toMs)}
      ${q.agentId ? sql`and c.agent_id = ${q.agentId}` : sql``}
    order by c.at desc
    limit ${LIMIT + 1}`);

  const items: VisitorRating[] = rows.rows.slice(0, LIMIT).map((r) => {
    const known = !r.anonymized_at;
    const digits = known ? (r.visitor_phone ?? "") : "";
    return {
      id: r.id,
      at: new Date(r.at).toISOString(),
      displayNumber: r.display_number,
      score: r.score,
      comment: r.comment,
      source: r.source,
      visitor: {
        name: known ? r.visitor_name : null,
        phoneMasked: digits ? `••••${digits.slice(-3)}` : null,
        phone: fullPhone && digits ? digits : null,
      },
      desk: r.desk_number ? { number: r.desk_number, name: r.desk_name ?? {} } : null,
      agent: r.agent_id ? { id: r.agent_id, name: r.agent_name ?? {} } : null,
    };
  });
  return { timezone: tz, truncated: rows.rows.length > LIMIT, items };
}
