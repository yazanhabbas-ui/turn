import { listTemplates, saveTemplate, templateInput } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const GET = route({ permission: "templates.manage" }, async ({ actor }) => ({ items: await listTemplates(actor) }));

/** Creates or replaces the template for a channel + event. */
export const PUT = route({ permission: "templates.manage", body: templateInput }, async ({ actor, body }) =>
  saveTemplate(actor, body),
);
