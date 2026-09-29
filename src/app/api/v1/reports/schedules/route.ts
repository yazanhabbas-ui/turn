import {
  createReportSchedule,
  listReportSchedules,
  reportScheduleInput,
  reportScheduleOptions,
} from "@/server/admin/report-schedules";
import { route } from "@/server/http/route";

/** The schedules the caller may manage, plus what the form can pick (branches, reasons). */
export const GET = route({ permission: "reports.schedule" }, async ({ actor }) => ({
  items: await listReportSchedules(actor),
  options: await reportScheduleOptions(actor),
}));

export const POST = route({ permission: "reports.schedule", body: reportScheduleInput }, async ({ actor, body }) =>
  createReportSchedule(actor, body),
);
