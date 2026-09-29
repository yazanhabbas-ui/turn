import { revokeDisplay } from "@/server/admin/screens";
import { route } from "@/server/http/route";

/** Kills the screen's device token and disconnects it immediately. */
export const POST = route({ permission: "displays.manage" }, async ({ actor, params }) => {
  await revokeDisplay(actor, params.id);
  return { ok: true };
});
