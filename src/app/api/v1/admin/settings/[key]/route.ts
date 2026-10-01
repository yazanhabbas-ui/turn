import { z } from "zod";
import { clearSettingOverride, updateSetting } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/**
 * Replaces one setting group (validated against its schema in src/server/settings/registry.ts).
 * `?cityId=` writes a city's own value, `?branchId=` a branch's (only for settings that level may override).
 * Who may write is decided by the service: organization-wide needs settings.manage, a city needs branch
 * management over the whole city, a branch needs branches.manage there.
 */
export const PUT = route({ permission: "admin.access", body: z.unknown() }, async ({ actor, body, params, query }) => ({
  value: await updateSetting(actor, params.key, body, query.get("branchId") || null, query.get("cityId") || null),
}));

/** `?cityId=` or `?branchId=` is required: removes that scope's own value so it inherits from the level above again. */
export const DELETE = route({ permission: "admin.access" }, async ({ actor, params, query }) => {
  const branchId = query.get("branchId") || null;
  const cityId = query.get("cityId") || null;
  if (!branchId && !cityId) return { ok: false };
  await clearSettingOverride(actor, params.key, branchId, cityId);
  return { ok: true };
});
