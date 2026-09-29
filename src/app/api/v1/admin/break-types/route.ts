import { breakTypeInput, saveBreakType } from "@/server/admin/catalog";
import { route } from "@/server/http/route";

export const POST = route({ permission: "settings.manage", body: breakTypeInput }, async ({ actor, body }) =>
  saveBreakType(actor, null, body),
);
