import { newPairingCode } from "@/server/admin/screens";
import { route } from "@/server/http/route";

/** New single-use pairing code (valid 15 minutes) for a screen that needs to be paired again. */
export const POST = route({ permission: "displays.manage" }, async ({ actor, params }) => newPairingCode(actor, params.id));
