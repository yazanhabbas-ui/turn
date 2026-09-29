import { sendReportScheduleNow } from "@/server/admin/report-schedules";
import { route } from "@/server/http/route";

/** Sends the schedule's report for its usual period right now, without moving its last-run time. */
export const POST = route(
  { permission: "reports.schedule", rateLimit: { name: "report-schedule-send", limit: 10, windowMs: 60_000, by: "user" } },
  async ({ actor, params }) => sendReportScheduleNow(actor, params.id),
);
