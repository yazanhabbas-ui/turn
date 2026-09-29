import { readAllSettings } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

export const GET = route({ permission: "admin.access" }, async ({ actor, query }) =>
  readAllSettings(actor, query.get("branchId")),
);
