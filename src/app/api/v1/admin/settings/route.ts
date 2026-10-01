import { readAllSettings } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/** Effective settings for the organization, or for `?cityId=` / `?branchId=` (organization ← city ← branch). */
export const GET = route({ permission: "admin.access" }, async ({ actor, query }) =>
  readAllSettings(actor, query.get("branchId") || null, query.get("cityId") || null),
);
