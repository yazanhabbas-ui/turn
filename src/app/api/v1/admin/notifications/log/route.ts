import { listNotificationLog, logFilter } from "@/server/admin/notifications";
import { route } from "@/server/http/route";

/** Delivery log of visitor notifications (masked recipients), newest first. */
export const GET = route({ permission: "branches.manage" }, async ({ actor, query }) =>
  listNotificationLog(actor, logFilter.parse(Object.fromEntries(query))),
);
