import { waitAnalytics } from "@/server/admin/wait-analytics";
import { route } from "@/server/http/route";

/** Real service durations per reason (`?branchId=`, or the whole organization without it). */
export const GET = route(
  { permission: "admin.access", rateLimit: { name: "wait-analytics", limit: 30, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => waitAnalytics(actor, query.get("branchId") || null),
);
