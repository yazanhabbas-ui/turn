import { announcementInput, deleteAnnouncement, saveAnnouncement } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const PUT = route({ permission: "announcements.manage", body: announcementInput }, async ({ actor, body, params }) =>
  saveAnnouncement(actor, params.id, body),
);

export const DELETE = route({ permission: "announcements.manage" }, async ({ actor, params }) => {
  await deleteAnnouncement(actor, params.id);
  return { ok: true };
});
