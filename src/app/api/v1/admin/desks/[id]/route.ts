import { archiveDesk, deskInput, updateDesk } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "branches.manage", body: deskInput }, async ({ actor, body, params }) => {
  await updateDesk(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "branches.manage" }, async ({ actor, params }) => {
  await archiveDesk(actor, params.id);
  return { ok: true };
});
