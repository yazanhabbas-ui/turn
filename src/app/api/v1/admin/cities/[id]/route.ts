import { archiveCity, cityInput, updateCity } from "@/server/admin/cities";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "cities.manage", body: cityInput }, async ({ actor, body, params }) => {
  await updateCity(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "cities.manage" }, async ({ actor, params }) => {
  await archiveCity(actor, params.id);
  return { ok: true };
});
