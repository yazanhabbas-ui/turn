import { deleteReportSchedule, reportScheduleInput, updateReportSchedule } from "@/server/admin/report-schedules";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "reports.schedule", body: reportScheduleInput }, async ({ actor, body, params }) =>
  updateReportSchedule(actor, params.id, body),
);

export const DELETE = route({ permission: "reports.schedule" }, async ({ actor, params }) => {
  await deleteReportSchedule(actor, params.id);
  return { ok: true };
});
