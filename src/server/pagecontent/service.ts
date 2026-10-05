import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import type { TextOverrides } from "@/domain/pagecontent/text";
import { getDefaultOrganizationId } from "../branding";
import { getSetting } from "../settings/service";

/**
 * Overridden visitor-page texts for pages that are not the status page itself (the stop-messages page and the
 * "not found" notice). A ticket decides its branch; without a ticket the organization-wide wording is used.
 */
export async function visitorTextsForTicket(token: string): Promise<TextOverrides> {
  const [t] = await db()
    .select({ organizationId: tickets.organizationId, branchId: tickets.branchId })
    .from(tickets)
    .where(eq(tickets.publicToken, token));
  if (!t) return visitorTextsDefault();
  return (await getSetting(t.organizationId, "pageContent", t.branchId)).visitor.texts;
}

export async function visitorTextsDefault(): Promise<TextOverrides> {
  const org = await getDefaultOrganizationId();
  return org ? (await getSetting(org, "pageContent")).visitor.texts : {};
}
