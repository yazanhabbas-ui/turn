import { route } from "@/server/http/route";
import { liveView } from "@/server/reports/live";

/** Wallboard data: tiles, desks, reasons, long waits and open alerts for one branch. */
export const GET = route(
  { permission: "wallboard.view", rateLimit: { name: "wallboard-live", limit: 240, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => liveView(actor, query.get("branchId") || undefined),
);
