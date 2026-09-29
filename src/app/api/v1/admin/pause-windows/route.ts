import { pauseInput, savePauseWindow } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

export const POST = route({ permission: "branches.manage", body: pauseInput }, async ({ actor, body }) =>
  savePauseWindow(actor, null, body),
);
