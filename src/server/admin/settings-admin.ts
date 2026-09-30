import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { io } from "../realtime";
import { db } from "@/db/client";
import { auditLogs, branches, settings, users } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { BRANCH_OVERRIDABLE, SETTINGS, type SettingKey, type SettingValue } from "../settings/registry";
import { getSetting, putSetting } from "../settings/service";
import { allowedBranches, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

export async function readAllSettings(actor: Actor, branchId?: string | null) {
  requirePermission(actor, "admin.access", branchId);
  const entries = await Promise.all(SETTING_KEYS.map(async (k) => [k, await getSetting(orgOf(actor), k, branchId)] as const));
  return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
}

/** Who may write this scope: organization-wide needs settings.manage everywhere; a branch value needs branch management. */
async function assertSettingScope(actor: Actor, key: SettingKey, branchId: string | null) {
  if (!branchId) return requireOrgWide(actor, "settings.manage");
  if (!(BRANCH_OVERRIDABLE as readonly string[]).includes(key))
    throw new AppError("validation", { reason: "not_overridable", key });
  requirePermission(actor, "branches.manage", branchId);
  const [b] = await db().select({ organizationId: branches.organizationId }).from(branches).where(eq(branches.id, branchId));
  if (!b || b.organizationId !== orgOf(actor)) throw new AppError("not_found");
}

export async function updateSetting(actor: Actor, key: string, raw: unknown, branchId: string | null = null) {
  if (!isSettingKey(key)) throw new AppError("not_found");
  await assertSettingScope(actor, key, branchId);
  const value = SETTINGS[key].parse(raw);
  const before = await getSetting(orgOf(actor), key, branchId);
  await putSetting(orgOf(actor), key, value as never, { userId: actor.auth.user.id, branchId });
  // Screens read voice and regional settings from their state, so tell them to refetch.
  if (key === "voice" || key === "regional" || key === "branding")
    io()
      ?.to(`displays:${orgOf(actor)}`)
      .emit("display.refresh", {});
  await audit({
    ...auditMeta(actor),
    branchId,
    action: "setting.updated",
    entityType: "setting",
    entityId: key,
    before,
    after: value,
  });
  return value;
}

/** Removes a branch's own value so it inherits the organization default again. */
export async function clearSettingOverride(actor: Actor, key: string, branchId: string) {
  if (!isSettingKey(key)) throw new AppError("not_found");
  await assertSettingScope(actor, key, branchId);
  await db()
    .delete(settings)
    .where(and(eq(settings.organizationId, orgOf(actor)), eq(settings.key, key), eq(settings.branchId, branchId)));
  await audit({ ...auditMeta(actor), branchId, action: "setting.override_cleared", entityType: "setting", entityId: key });
  if (key === "voice" || key === "regional" || key === "branding")
    io()
      ?.to(`displays:${orgOf(actor)}`)
      .emit("display.refresh", {});
}

export async function listAudit(
  actor: Actor,
  filter: { entityType?: string; actorUserId?: string; from?: string; to?: string; before?: string; limit?: number },
) {
  requirePermission(actor, "audit.view");
  const conds: SQL[] = [eq(auditLogs.organizationId, orgOf(actor))];
  // Branch-limited roles only see what happened in their own branches.
  const scope = allowedBranches(actor, "audit.view");
  if (scope !== "all") conds.push(scope.length ? inArray(auditLogs.branchId, scope) : sql`false`);
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
