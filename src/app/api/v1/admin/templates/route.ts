import { deleteCityTemplate, listTemplates, saveTemplate, templateInput } from "@/server/admin/screens";
import { route } from "@/server/http/route";

/** The organization's templates; `?cityId=` lists only that city's own overrides. */
export const GET = route({ permission: "admin.access" }, async ({ actor, query }) => ({
  items: await listTemplates(actor, query.get("cityId") || null),
}));

/** Creates or replaces the template for a channel + event (`cityId` in the body = that city's own wording). */
export const PUT = route({ permission: "admin.access", body: templateInput }, async ({ actor, body }) =>
  saveTemplate(actor, body),
);

/** `?cityId=&channel=&event=`: removes a city's own template so it inherits the organization's again. */
export const DELETE = route({ permission: "admin.access" }, async ({ actor, query }) => {
  const cityId = query.get("cityId");
  const channel = query.get("channel");
  const event = query.get("event");
  if (!cityId || !channel || !event) return { ok: false };
  await deleteCityTemplate(actor, cityId, channel, event);
  return { ok: true };
});
