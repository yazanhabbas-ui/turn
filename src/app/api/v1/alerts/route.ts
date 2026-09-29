import { route } from "@/server/http/route";
import { listAlerts } from "@/server/reports/alerts";

export const GET = route({ permission: "alerts.view" }, async ({ actor, query }) => ({
  items: await listAlerts(actor, { openOnly: query.get("open") === "1", limit: Number(query.get("limit") ?? 50) }),
}));
