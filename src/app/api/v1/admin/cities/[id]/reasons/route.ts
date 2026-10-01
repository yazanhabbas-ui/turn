import { cityReasonInput, listCityReasons, setCityReason } from "@/server/admin/city-reasons";
import { route } from "@/server/http/route";

/** Organization reasons with whether this city has them enabled (all enabled by default). */
export const GET = route({ permission: "admin.access" }, async ({ actor, params }) => ({
  items: await listCityReasons(actor, params.id),
}));

/** Enables or hides one reason in this city (city admins for their own city, super admin for any). */
export const PUT = route({ permission: "admin.access", body: cityReasonInput }, async ({ actor, params, body }) => {
  await setCityReason(actor, params.id, body);
  return { ok: true };
});
