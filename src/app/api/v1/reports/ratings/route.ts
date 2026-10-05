import { route } from "@/server/http/route";
import { reportMeta } from "@/server/reports/service";
import { ratingsQuery, visitorRatings } from "@/server/reports/ratings";

/** Visitor ratings with visitor, desk, agent, score and comment, for a date range (optionally one branch or agent). */
export const GET = route(
  { permission: "reports.view", rateLimit: { name: "report-ratings", limit: 60, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => {
    const q = ratingsQuery.parse({
      from: query.get("from"),
      to: query.get("to"),
      branchId: query.get("branchId") || undefined,
      agentId: query.get("agentId") || undefined,
    });
    const [ratings, meta] = await Promise.all([visitorRatings(actor, q), reportMeta(actor)]);
    return { ...ratings, agents: meta.agents };
  },
);
