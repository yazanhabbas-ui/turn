import { archiveGroup, groupInput, saveGroup } from "@/server/admin/groups";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "reasons.manage", body: groupInput }, async ({ actor, body, params }) =>
  saveGroup(actor, params.id, body),
);

export const DELETE = route({ permission: "reasons.manage" }, async ({ actor, params }) => {
  await archiveGroup(actor, params.id);
  return { ok: true };
});
