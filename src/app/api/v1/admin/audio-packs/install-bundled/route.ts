import { addBundledVoices } from "@/server/admin/screens";
import { route } from "@/server/http/route";

/** Adds the Arabic voices that ship with the project to the organization (idempotent). */
export const POST = route({ permission: "templates.manage" }, async ({ actor }) => addBundledVoices(actor));
