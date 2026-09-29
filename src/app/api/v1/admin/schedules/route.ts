import { listHolidays, listPauseWindows, listSchedules, saveSchedule, scheduleInput } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

/** Schedules, pause windows (prayer times) and holidays in one call for the "Working hours" page. */
export const GET = route({ permission: "reasons.view" }, async ({ actor }) => {
  const [schedules, pauses, holidays] = await Promise.all([listSchedules(actor), listPauseWindows(actor), listHolidays(actor)]);
  return { schedules, pauses, holidays };
});

export const POST = route({ permission: "reasons.manage", body: scheduleInput }, async ({ actor, body }) =>
  saveSchedule(actor, null, body),
);
