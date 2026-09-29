import { archiveSchedule, saveSchedule, scheduleInput } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "reasons.manage", body: scheduleInput }, async ({ actor, body, params }) =>
  saveSchedule(actor, params.id, body),
);

export const DELETE = route({ permission: "reasons.manage" }, async ({ actor, params }) => {
  await archiveSchedule(actor, params.id);
  return { ok: true };
});
