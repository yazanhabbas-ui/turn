import { route } from "@/server/http/route";
import { buildForecast } from "@/server/reports/service";

export const GET = route({ permission: "reports.view" }, async ({ actor, query }) =>
  buildForecast(actor, query.get("branchId") || undefined),
);
