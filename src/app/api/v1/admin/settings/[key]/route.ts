import { z } from "zod";
import { updateSetting } from "@/server/admin/settings-admin";
import { route } from "@/server/http/route";

/** Replaces one setting group (validated against its schema in src/server/settings/registry.ts). */
export const PUT = route({ permission: "settings.manage", body: z.unknown() }, async ({ actor, body, params }) => ({
  value: await updateSetting(actor, params.key, body),
}));
