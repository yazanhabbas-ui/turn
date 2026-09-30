import { waitAnalytics } from "@/server/admin/wait-analytics";
import { route } from "@/server/http/route";

/** Real service durations per reason (`?branchId=`, or the whole organization without it). */
export const GET = route({ permission: "admin.access" }, async ({ actor, query }) =>
  waitAnalytics(actor, query.get("branchId") || null),
);
