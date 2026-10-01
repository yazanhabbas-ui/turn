import { route } from "@/server/http/route";
import { myReport, reportQuery } from "@/server/profile/report";

/**
 * The signed-in agent's own work report (`period=day|week|month`, or `from` and `to` as YYYY-MM-DD, at most 92 days).
 * Own tickets only; `403` (`reason: agents_only`) for accounts without an agent profile.
 */
export const GET = route({}, async ({ actor, query }) =>
  myReport(
    actor,
    reportQuery.parse({
      period: query.get("period") ?? undefined,
      from: query.get("from") ?? undefined,
      to: query.get("to") ?? undefined,
    }),
  ),
);
