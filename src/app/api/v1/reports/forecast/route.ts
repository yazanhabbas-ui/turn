import { route } from "@/server/http/route";
import { buildForecast } from "@/server/reports/service";

export const GET = route(
  { permission: "reports.view", rateLimit: { name: "report-forecast", limit: 30, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => buildForecast(actor, query.get("branchId") || undefined),
);
