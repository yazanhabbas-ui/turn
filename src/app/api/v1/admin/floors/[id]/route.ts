import { archiveFloor, floorInput, updateFloor } from "@/server/admin/branches";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "branches.manage", body: floorInput }, async ({ actor, body, params }) => {
  await updateFloor(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "branches.manage" }, async ({ actor, params }) => {
  await archiveFloor(actor, params.id);
  return { ok: true };
});
