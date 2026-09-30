import { archiveShift, shiftInput, updateShift } from "@/server/admin/shifts";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "admin.access", body: shiftInput }, async ({ actor, body, params }) => {
  await updateShift(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "admin.access" }, async ({ actor, params }) => {
  await archiveShift(actor, params.id);
  return { ok: true };
});
