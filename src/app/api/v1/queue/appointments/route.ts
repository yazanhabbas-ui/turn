import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { lookupAppointment } from "@/server/queue/views";

export const GET = route({ permission: "appointments.checkin" }, async ({ actor, query }) => {
  const branchId = query.get("branchId");
  const code = query.get("code");
  if (!branchId || !code) throw new AppError("validation", { field: branchId ? "code" : "branchId" });
  return lookupAppointment(actor, branchId, code);
});
