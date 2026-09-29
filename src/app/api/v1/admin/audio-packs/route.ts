import { audioPackInput, listAudioPacks, saveAudioPack } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const GET = route({ permission: "templates.manage" }, async ({ actor }) => ({ items: await listAudioPacks(actor) }));

export const POST = route({ permission: "templates.manage", body: audioPackInput }, async ({ actor, body }) =>
  saveAudioPack(actor, null, body),
);
