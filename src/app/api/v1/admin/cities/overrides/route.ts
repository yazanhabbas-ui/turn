import { listCityOverrides } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/** Per visible city: the settings it overrides, branch overrides inside it and reasons it hides. */
export const GET = route({ permission: "admin.access" }, async ({ actor }) => ({ items: await listCityOverrides(actor) }));
