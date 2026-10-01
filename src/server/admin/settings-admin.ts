import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { io } from "../realtime";
import { db } from "@/db/client";
import { auditLogs, branches, cities, cityReasons, settings, users } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import {
  isBranchOverridable,
  isCityOverridable,
  localImage,
  SETTINGS,
  type SettingKey,
  type SettingValue,
} from "../settings/registry";
import { getSettingSource, putSetting, type SettingSource } from "../settings/service";
import { allowedBranches, auditMeta, orgOf, requireCityAccess, requireOrgWide, requirePermission, type Actor } from "./actor";

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

/** Where a value is read or written: the organization (both empty), one city, or one branch. */
export type ScopeArg = { branchId?: string | null; cityId?: string | null };

/** Loads the city (in the actor's organization) or answers 404. */
async function loadCity(actor: Actor, cityId: string) {
  const [c] = await db()
    .select({ id: cities.id, organizationId: cities.organizationId })
    .from(cities)
    .where(eq(cities.id, cityId));
  if (!c || c.organizationId !== orgOf(actor)) throw new AppError("not_found");
  return c;
}

/** May the actor look at this city's configuration: a grant on the city, or on any of its branches. */
async function requireCityRead(actor: Actor, cityId: string) {
  await loadCity(actor, cityId);
  const scope = allowedBranches(actor, "admin.access");
  if (scope === "all") return;
  const rows = await db().select({ id: branches.id }).from(branches).where(eq(branches.cityId, cityId));
  const ok =
    actor.auth.grants.some((g) => g.permissions.includes("admin.access") && g.cityId === cityId) ||
    rows.some((b) => scope.includes(b.id));
  if (!ok) throw new AppError("forbidden", { permission: "admin.access", cityId });
}

async function requireScopeRead(actor: Actor, scope: ScopeArg) {
  if (scope.branchId && scope.cityId) throw new AppError("validation", { reason: "one_scope" });
  if (scope.branchId) requirePermission(actor, "admin.access", scope.branchId);
  else if (scope.cityId) await requireCityRead(actor, scope.cityId);
  else requirePermission(actor, "admin.access");
}

export async function readAllSettings(actor: Actor, branchId?: string | null, cityId?: string | null) {
  await requireScopeRead(actor, { branchId, cityId });
  const org = orgOf(actor);
  const entries = await Promise.all(
    SETTING_KEYS.map(async (k) => [k, (await getSettingSource(org, k, { branchId, cityId })).value] as const),
  );
  return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
}

/**
 * For the selected scope: per key, where the effective value comes from (`source`) and whether this very scope holds
 * its own override (`own`). Keys a city or branch may not override are always sourced from the organization.
 */
export async function readSettingSources(actor: Actor, scope: ScopeArg) {
  await requireScopeRead(actor, scope);
  const org = orgOf(actor);
  const out: Record<string, { source: SettingSource; own: boolean; overridable: boolean }> = {};
  await Promise.all(
    SETTING_KEYS.map(async (k) => {
      const overridable = scope.branchId ? isBranchOverridable(k) : scope.cityId ? isCityOverridable(k) : false;
      const { source } = await getSettingSource(org, k, scope);
      const own = scope.branchId
        ? source.level === "branch"
        : scope.cityId
          ? source.level === "city" && source.cityId === scope.cityId
          : false;
      out[k] = { source, own, overridable };
    }),
  );
  return out;
}

/** Who may write this scope: the organization needs settings.manage everywhere; a city needs city-wide branch management; a branch needs branch management. */
async function assertSettingScope(actor: Actor, key: SettingKey, branchId: string | null, cityId: string | null) {
  if (branchId && cityId) throw new AppError("validation", { reason: "one_scope" });
  if (cityId) {
    if (!isCityOverridable(key)) throw new AppError("validation", { reason: "not_overridable", key });
    await loadCity(actor, cityId);
    requireCityAccess(actor, "branches.manage", cityId);
    return;
  }
  if (!branchId) return requireOrgWide(actor, "settings.manage");
  if (!isBranchOverridable(key)) throw new AppError("validation", { reason: "not_overridable", key });
  requirePermission(actor, "branches.manage", branchId);
  const [b] = await db().select({ organizationId: branches.organizationId }).from(branches).where(eq(branches.id, branchId));
  if (!b || b.organizationId !== orgOf(actor)) throw new AppError("not_found");
}

/** Keys that change what a screen shows or says: tell the affected screens to refetch their state. */
const SCREEN_KEYS: readonly SettingKey[] = ["voice", "regional", "branding", "displayTheme", "wallboard"];

/** Asks the screens a change reaches to refetch: one branch's, every branch of a city, or all of the organization. */
export async function refreshScreens(organizationId: string, key: SettingKey, scope: ScopeArg) {
  if (!SCREEN_KEYS.includes(key)) return;
  const hub = io();
  if (!hub) return;
  if (scope.branchId) hub.to(`screens:${scope.branchId}`).emit("display.refresh", {});
  else if (scope.cityId) {
    const rows = await db().select({ id: branches.id }).from(branches).where(eq(branches.cityId, scope.cityId));
    for (const b of rows) hub.to(`screens:${b.id}`).emit("display.refresh", {});
  } else hub.to(`displays:${organizationId}`).emit("display.refresh", {});
}

/** Audit metadata for a scope: the city shows up in the action and in the recorded values, the branch in `branchId`. */
function auditShape(scope: ScopeArg, kind: "updated" | "override_cleared") {
  return {
    action: scope.cityId ? `setting.city_${kind}` : `setting.${kind}`,
    wrap: (value: unknown) => (scope.cityId ? { cityId: scope.cityId, value } : value),
  };
}

export async function updateSetting(
  actor: Actor,
  key: string,
  raw: unknown,
  branchId: string | null = null,
  cityId: string | null = null,
) {
  if (!isSettingKey(key)) throw new AppError("not_found");
  await assertSettingScope(actor, key, branchId, cityId);
  if (key === "branding" && raw && typeof raw === "object") {
    // A stored value that is not local would be dropped silently on the next read: say so now instead.
    for (const field of ["logoUrl", "logoDarkUrl"] as const) {
      const v = (raw as Record<string, unknown>)[field];
      if (typeof v === "string" && !localImage.safeParse(v).success)
        throw new AppError("validation", { field, reason: "local_image_only" });
    }
  }
  const value = SETTINGS[key].parse(raw);
  const before = await getSettingSource(orgOf(actor), key, { branchId, cityId }).then((r) => r.value);
  await putSetting(orgOf(actor), key, value as never, { userId: actor.auth.user.id, branchId, cityId });
  await refreshScreens(orgOf(actor), key, { branchId, cityId });
  const shape = auditShape({ branchId, cityId }, "updated");
  await audit({
    ...auditMeta(actor),
    branchId,
    action: shape.action,
    entityType: "setting",
    entityId: key,
    before: shape.wrap(before),
    after: shape.wrap(value),
  });
  return value;
}

/** Removes a branch's or city's own value so it inherits from the level above again. */
export async function clearSettingOverride(actor: Actor, key: string, branchId: string | null, cityId: string | null = null) {
  if (!isSettingKey(key)) throw new AppError("not_found");
  if (!branchId && !cityId) throw new AppError("validation", { reason: "no_scope" });
  await assertSettingScope(actor, key, branchId, cityId);
  const [removed] = await db()
    .delete(settings)
    .where(
      and(
        eq(settings.organizationId, orgOf(actor)),
        eq(settings.key, key),
        branchId ? eq(settings.branchId, branchId) : and(eq(settings.cityId, cityId!), isNull(settings.branchId)),
      ),
    )
    .returning({ value: settings.value });
  const shape = auditShape({ branchId, cityId }, "override_cleared");
  await audit({
    ...auditMeta(actor),
    branchId,
    action: shape.action,
    entityType: "setting",
    entityId: key,
    before: removed ? shape.wrap(removed.value) : undefined,
  });
  await refreshScreens(orgOf(actor), key, { branchId, cityId });
}

/**
 * Overview for the Cities page: per visible city, which settings it overrides and how many branches override on
 * their own. A city admin only gets their own city.
 */
export async function listCityOverrides(actor: Actor) {
  requirePermission(actor, "admin.access");
  const org = orgOf(actor);
  const cityRows = await db().select().from(cities).where(eq(cities.organizationId, org));
  const visible: typeof cityRows = [];
  for (const c of cityRows) {
    try {
      await requireCityRead(actor, c.id);
      visible.push(c);
    } catch {
      /* not visible to this actor */
    }
  }
  const rows = await db()
    .select({ cityId: settings.cityId, key: settings.key })
    .from(settings)
    .where(and(eq(settings.organizationId, org), isNotNull(settings.cityId)));
  const branchRows = await db()
    .select({ cityId: branches.cityId, key: settings.key })
    .from(settings)
    .innerJoin(branches, eq(branches.id, settings.branchId))
    .where(eq(settings.organizationId, org));
  const disabled = await db()
    .select({ cityId: cityReasons.cityId })
    .from(cityReasons)
    .where(and(eq(cityReasons.organizationId, org), eq(cityReasons.enabled, false)));
  return visible.map((c) => ({
    cityId: c.id,
    overrides: rows.filter((r) => r.cityId === c.id).map((r) => r.key),
    branchOverrides: branchRows.filter((r) => r.cityId === c.id).length,
    hiddenReasons: disabled.filter((r) => r.cityId === c.id).length,
  }));
}

/**
 * Copies one city's configuration onto another (settings overrides and hidden reasons), replacing what the target had.
 * Organization-wide administrators only.
 */
export async function copyCityConfiguration(actor: Actor, fromCityId: string, toCityId: string) {
  requireOrgWide(actor, "settings.manage");
  if (fromCityId === toCityId) throw new AppError("validation", { reason: "same_city" });
  await loadCity(actor, fromCityId);
  await loadCity(actor, toCityId);
  const org = orgOf(actor);
  const result = await db().transaction(async (tx) => {
    const source = await tx
      .select()
      .from(settings)
      .where(and(eq(settings.organizationId, org), eq(settings.cityId, fromCityId)));
    await tx.delete(settings).where(and(eq(settings.organizationId, org), eq(settings.cityId, toCityId)));
    for (const row of source)
      await putSetting(org, row.key as SettingKey, row.value as never, { cityId: toCityId, userId: actor.auth.user.id }, tx);
    const hidden = await tx
      .select()
      .from(cityReasons)
      .where(and(eq(cityReasons.cityId, fromCityId), eq(cityReasons.enabled, false)));
    await tx.delete(cityReasons).where(eq(cityReasons.cityId, toCityId));
    if (hidden.length)
      await tx.insert(cityReasons).values(
        hidden.map((h) => ({
          organizationId: org,
          cityId: toCityId,
          reasonId: h.reasonId,
          enabled: false,
          updatedByUserId: actor.auth.user.id,
        })),
      );
    await audit(
      {
        ...auditMeta(actor),
        action: "city.configuration_copied",
        entityType: "city",
        entityId: toCityId,
        after: { fromCityId, settings: source.map((s) => s.key), hiddenReasons: hidden.length },
      },
      tx,
    );
    return { settings: source.length, hiddenReasons: hidden.length };
  });
  for (const key of SCREEN_KEYS) await refreshScreens(org, key, { cityId: toCityId });
  return result;
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
  const limit = Math.min(Math.max(Number.isFinite(filter.limit) ? Math.trunc(filter.limit!) : 50, 1), 200);
  // A malformed date is a client error, not a database failure.
  for (const d of [filter.from, filter.to, filter.before])
    if (d && Number.isNaN(new Date(d).getTime())) throw new AppError("validation", { field: "date" });
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
