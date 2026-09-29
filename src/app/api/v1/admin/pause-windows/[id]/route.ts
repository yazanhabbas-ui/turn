import { deletePauseWindow, pauseInput, savePauseWindow } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "branches.manage", body: pauseInput }, async ({ actor, body, params }) =>
  savePauseWindow(actor, params.id, body),
);

export const DELETE = route({ permission: "branches.manage" }, async ({ actor, params }) => {
  await deletePauseWindow(actor, params.id);
  return { ok: true };
});
