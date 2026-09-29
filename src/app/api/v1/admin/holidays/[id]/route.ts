import { deleteHoliday, holidayInput, saveHoliday } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "branches.manage", body: holidayInput }, async ({ actor, body, params }) =>
  saveHoliday(actor, params.id, body),
);

export const DELETE = route({ permission: "branches.manage" }, async ({ actor, params }) => {
  await deleteHoliday(actor, params.id);
  return { ok: true };
});
