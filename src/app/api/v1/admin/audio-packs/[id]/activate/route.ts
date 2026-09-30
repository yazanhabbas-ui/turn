import { activateAudioPack } from "@/server/admin/screens";
import { route } from "@/server/http/route";

/** Uses this pack as the voice of its language (and switches announcements to pre-recorded clips). */
export const POST = route({ permission: "templates.manage" }, async ({ actor, params }) => activateAudioPack(actor, params.id));
