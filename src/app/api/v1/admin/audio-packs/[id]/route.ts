import { audioPackInput, deleteAudioPack, saveAudioPack } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "templates.manage", body: audioPackInput }, async ({ actor, body, params }) =>
  saveAudioPack(actor, params.id, body),
);

export const DELETE = route({ permission: "templates.manage" }, async ({ actor, params }) => {
  await deleteAudioPack(actor, params.id);
  return { ok: true };
});
