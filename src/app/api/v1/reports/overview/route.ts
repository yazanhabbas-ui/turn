import { route } from "@/server/http/route";
import { buildReport, filtersFromQuery, reportMeta } from "@/server/reports/service";

/** KPIs for a date range and filters (branch, reason, agent, weekdays, hours). `meta` lists what the filters can be set to. */
export const GET = route(
  { permission: "reports.view", rateLimit: { name: "report-overview", limit: 60, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => {
    const [report, meta] = await Promise.all([buildReport(actor, filtersFromQuery(query)), reportMeta(actor)]);
    return { ...report, meta };
  },
);
