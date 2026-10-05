import { route } from "@/server/http/route";
import { detailsQuery, myReportDetails, reportQuery } from "@/server/profile/report";

/** One page of the agent's served-visitors detail report, newest first ("load more" with `before`). */
export const GET = route({}, async ({ actor, query }) =>
  myReportDetails(
    actor,
    reportQuery.parse({
      period: query.get("period") ?? undefined,
      from: query.get("from") ?? undefined,
      to: query.get("to") ?? undefined,
    }),
    detailsQuery.parse({
      outcome: query.get("outcome") || undefined,
      reasonId: query.get("reasonId") || undefined,
      negativeOnly: query.get("negativeOnly") === "1" ? true : undefined,
      before: query.get("before") || undefined,
      limit: query.get("limit") ? Number(query.get("limit")) : undefined,
    }),
  ),
);
