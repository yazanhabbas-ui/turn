import { route } from "@/server/http/route";
import { acknowledgeAlert } from "@/server/reports/alerts";

export const POST = route({ permission: "alerts.manage" }, async ({ actor, params }) => acknowledgeAlert(actor, params.id));
