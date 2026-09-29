import { holidayInput, saveHoliday } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

export const POST = route({ permission: "branches.manage", body: holidayInput }, async ({ actor, body }) =>
  saveHoliday(actor, null, body),
);
