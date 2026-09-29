import { deleteDisplay, displayInput, updateDisplay } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "displays.manage", body: displayInput }, async ({ actor, body, params }) =>
  updateDisplay(actor, params.id, body),
);

export const DELETE = route({ permission: "displays.manage" }, async ({ actor, params }) => {
  await deleteDisplay(actor, params.id);
  return { ok: true };
});
