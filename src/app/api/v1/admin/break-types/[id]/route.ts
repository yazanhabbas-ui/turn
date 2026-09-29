import { archiveBreakType, breakTypeInput, saveBreakType } from "@/server/admin/catalog";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "settings.manage", body: breakTypeInput }, async ({ actor, body, params }) =>
  saveBreakType(actor, params.id, body),
);

export const DELETE = route({ permission: "settings.manage" }, async ({ actor, params }) => {
  await archiveBreakType(actor, params.id);
  return { ok: true };
});
