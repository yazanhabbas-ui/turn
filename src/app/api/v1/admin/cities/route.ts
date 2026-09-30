import { cityInput, createCity, listCities } from "@/server/admin/cities";
import { route } from "@/server/http/route";

export const GET = route({ permission: "admin.access" }, async ({ actor }) => ({ items: await listCities(actor) }));

export const POST = route({ permission: "cities.manage", body: cityInput }, async ({ actor, body }) => createCity(actor, body));
