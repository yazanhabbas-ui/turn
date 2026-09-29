import { and, desc, eq, gte, lt, lte, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { SETTINGS, type SettingKey, type SettingValue } from "../settings/registry";
import { getSetting, putSetting } from "../settings/service";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

export async function readAllSettings(actor: Actor, branchId?: string | null) {
  requirePermission(actor, "admin.access");
  const entries = await Promise.all(SETTING_KEYS.map(async (k) => [k, await getSetting(orgOf(actor), k, branchId)] as const));
  return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
}

export async function updateSetting(actor: Actor, key: string, raw: unknown) {
  requireOrgWide(actor, "settings.manage");
  if (!isSettingKey(key)) throw new AppError("not_found");
  const value = SETTINGS[key].parse(raw);
  const before = await getSetting(orgOf(actor), key);
  await putSetting(orgOf(actor), key, value as never, { userId: actor.auth.user.id });
  await audit({ ...auditMeta(actor), action: "setting.updated", entityType: "setting", entityId: key, before, after: value });
  return value;
}

export async function listAudit(
  actor: Actor,
  filter: { entityType?: string; actorUserId?: string; from?: string; to?: string; before?: string; limit?: number },
) {
  requirePermission(actor, "audit.view");
  const conds: SQL[] = [eq(auditLogs.organizationId, orgOf(actor))];
  if (filter.entityType) conds.push(eq(auditLogs.entityType, filter.entityType));
  if (filter.actorUserId) conds.push(eq(auditLogs.actorUserId, filter.actorUserId));
  if (filter.from) conds.push(gte(auditLogs.at, new Date(filter.from)));
  if (filter.to) conds.push(lte(auditLogs.at, new Date(filter.to)));
  if (filter.before) conds.push(lt(auditLogs.at, new Date(filter.before)));
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = await db()
    .select({ log: auditLogs, actorName: users.displayName, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(...conds))
    .orderBy(desc(auditLogs.at))
    .limit(limit + 1);
  return {
    items: rows.slice(0, limit).map((r) => ({ ...r.log, actorName: r.actorName, actorEmail: r.actorEmail })),
    nextBefore: rows.length > limit ? rows[limit - 1].log.at.toISOString() : null,
  };
}
