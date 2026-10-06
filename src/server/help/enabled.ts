import { getSetting } from "../settings/service";

/** Whether the Help center is switched on for this organization (Settings app, General). */
export async function helpCenterEnabled(organizationId: string): Promise<boolean> {
  return (await getSetting(organizationId, "helpCenter", null)).enabled;
}
