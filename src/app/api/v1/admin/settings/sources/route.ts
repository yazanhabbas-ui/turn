import { readSettingSources } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/** For `?cityId=` or `?branchId=`: per setting, where its effective value comes from and whether this scope overrides it. */
export const GET = route({ permission: "admin.access" }, async ({ actor, query }) => ({
  sources: await readSettingSources(actor, { branchId: query.get("branchId") || null, cityId: query.get("cityId") || null }),
}));
