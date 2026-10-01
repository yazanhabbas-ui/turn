import { archiveHall, hallInput, updateHall } from "@/server/halls/admin";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "halls.manage", body: hallInput }, async ({ actor, body, params }) => {
  await updateHall(actor, params.id, body);
  return { ok: true };
});

export const DELETE = route({ permission: "halls.manage" }, async ({ actor, params }) => {
  await archiveHall(actor, params.id);
  return { ok: true };
});
