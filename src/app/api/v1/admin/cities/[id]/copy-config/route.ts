import { z } from "zod";
import { copyCityConfiguration } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/** Copies the configuration of `fromCityId` onto this city (organization-wide administrators only). */
export const POST = route(
  { permission: "admin.access", body: z.object({ fromCityId: z.string().uuid() }) },
  async ({ actor, body, params }) => copyCityConfiguration(actor, body.fromCityId, params.id),
);
