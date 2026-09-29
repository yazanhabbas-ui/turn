import { createDisplay, displayInput, listDisplays } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const GET = route({ permission: "displays.manage" }, async ({ actor }) => ({ items: await listDisplays(actor) }));

export const POST = route({ permission: "displays.manage", body: displayInput }, async ({ actor, body }) =>
  createDisplay(actor, body),
);
