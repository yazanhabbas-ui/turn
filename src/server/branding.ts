import "server-only";
import { asc } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { logger } from "./logger";
import { defaultSetting, type SettingValue } from "./settings/registry";
import { getSetting } from "./settings/service";

/**
 * Deployments are single-organization in the UI (the schema is multi-tenant). Public pages
 * (login, display) use the first organization; signed-in pages use the user's organization.
 */
export const getDefaultOrganizationId = cache(async (): Promise<string | null> => {
  const [org] = await db().select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  return org?.id ?? null;
});

export const getBranding = cache(async (organizationId?: string | null): Promise<SettingValue<"branding">> => {
  try {
    const orgId = organizationId ?? (await getDefaultOrganizationId());
    return orgId ? await getSetting(orgId, "branding") : defaultSetting("branding");
  } catch (err) {
    // The UI must still render (e.g. first boot before migrations); fall back to defaults.
    logger.warn({ err }, "branding unavailable, using defaults");
    return defaultSetting("branding");
  }
});
