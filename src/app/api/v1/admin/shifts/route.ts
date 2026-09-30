import { createShift, listShifts, shiftInput } from "@/server/admin/shifts";
import { route } from "@/server/http/route";

export const GET = route({ permission: "admin.access" }, async ({ actor }) => ({ items: await listShifts(actor) }));

export const POST = route({ permission: "admin.access", body: shiftInput }, async ({ actor, body }) => createShift(actor, body));
