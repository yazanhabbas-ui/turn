import { listSchedules, saveSchedule, scheduleInput } from "@/server/admin/schedules";
import { route } from "@/server/http/route";

/** Timetables for the "Working hours" page. */
export const GET = route({ permission: "reasons.view" }, async ({ actor }) => {
  return { schedules: await listSchedules(actor) };
});

export const POST = route({ permission: "reasons.manage", body: scheduleInput }, async ({ actor, body }) =>
  saveSchedule(actor, null, body),
);
