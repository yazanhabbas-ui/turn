import { priorityInput, savePriorityLevel } from "@/server/admin/catalog";
import { route } from "@/server/http/route";

export const POST = route({ permission: "distribution.manage", body: priorityInput }, async ({ actor, body }) =>
  savePriorityLevel(actor, null, body),
);
