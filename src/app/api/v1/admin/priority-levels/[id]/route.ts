import { archivePriorityLevel, priorityInput, savePriorityLevel } from "@/server/admin/catalog";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "distribution.manage", body: priorityInput }, async ({ actor, body, params }) =>
  savePriorityLevel(actor, params.id, body),
);

export const DELETE = route({ permission: "distribution.manage" }, async ({ actor, params }) => {
  await archivePriorityLevel(actor, params.id);
  return { ok: true };
});
