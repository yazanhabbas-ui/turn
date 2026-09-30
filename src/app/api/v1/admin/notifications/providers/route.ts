import { providersOverview } from "@/server/admin/notifications";
import { route } from "@/server/http/route";

/** Which channels can send (configured / not configured / mock). Never returns a secret. */
export const GET = route({ permission: "admin.access" }, async ({ actor }) => providersOverview(actor));
