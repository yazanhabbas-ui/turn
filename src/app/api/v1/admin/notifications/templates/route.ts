import { notificationTemplates } from "@/server/admin/notifications";
import { route } from "@/server/http/route";

/** The event × channel template grid (stored wording, or the built-in default). Edit with PUT /admin/templates. */
export const GET = route({ permission: "templates.manage" }, async ({ actor }) => ({
  items: await notificationTemplates(actor),
}));
