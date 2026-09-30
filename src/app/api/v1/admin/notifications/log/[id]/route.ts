import { resendNotification } from "@/server/admin/notifications";
import { route } from "@/server/http/route";

/** Re-queues a failed or skipped notification. */
export const POST = route({ permission: "admin.access" }, async ({ actor, params }) => resendNotification(actor, params.id));
