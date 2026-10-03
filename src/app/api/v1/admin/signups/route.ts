import { listSignups } from "@/server/admin/signups";
import { route } from "@/server/http/route";

export const GET = route({ permission: "users.invite" }, async ({ actor }) => ({ items: await listSignups(actor) }));
