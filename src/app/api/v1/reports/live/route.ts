import { route } from "@/server/http/route";
import { liveView } from "@/server/reports/live";

/** Wallboard data: tiles, desks, reasons, long waits and open alerts for one branch. */
export const GET = route({ permission: "wallboard.view" }, async ({ actor, query }) =>
  liveView(actor, query.get("branchId") || undefined),
);
