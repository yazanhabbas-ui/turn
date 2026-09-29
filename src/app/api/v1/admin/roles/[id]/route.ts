import { archiveRole, roleInput, updateRole } from "@/server/admin/roles";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "roles.manage", body: roleInput }, async ({ actor, body, params }) => {
  await updateRole(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "roles.manage" }, async ({ actor, params }) => {
  await archiveRole(actor, params.id);
  return { ok: true };
});
