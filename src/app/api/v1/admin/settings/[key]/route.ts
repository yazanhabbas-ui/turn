import { z } from "zod";
import { clearSettingOverride, updateSetting } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/**
 * Replaces one setting group (validated against its schema in src/server/settings/registry.ts).
 * `?branchId=` writes a branch's own value instead (only for settings a branch may override).
 * Who may write is decided by the service: organization-wide needs settings.manage, a branch needs branches.manage there.
 */
export const PUT = route({ permission: "admin.access", body: z.unknown() }, async ({ actor, body, params, query }) => ({
  value: await updateSetting(actor, params.key, body, query.get("branchId") || null),
}));

/** `?branchId=` is required: removes that branch's own value so it inherits the default again. */
export const DELETE = route({ permission: "admin.access" }, async ({ actor, params, query }) => {
  const branchId = query.get("branchId");
  if (!branchId) return { ok: false };
  await clearSettingOverride(actor, params.key, branchId);
  return { ok: true };
});
