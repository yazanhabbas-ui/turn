import { announcementInput, listAnnouncements, saveAnnouncement } from "@/server/admin/screens";
import { route } from "@/server/http/route";

export const GET = route({ permission: "announcements.manage" }, async ({ actor }) => ({
  items: await listAnnouncements(actor),
}));

export const POST = route({ permission: "announcements.manage", body: announcementInput }, async ({ actor, body }) =>
  saveAnnouncement(actor, null, body),
);
