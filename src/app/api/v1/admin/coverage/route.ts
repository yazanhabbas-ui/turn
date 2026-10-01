import { issuingCoverage } from "@/server/admin/coverage";
import { route } from "@/server/http/route";

/** How a visitor can get a ticket in each branch the administrator can see (receptionist, agent walk-in, kiosk). */
export const GET = route({ permission: "admin.access" }, async ({ actor }) => ({ items: await issuingCoverage(actor) }));
