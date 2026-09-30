import { branchesFor, can, canInCity, citiesFor, type Permission } from "@/domain/rbac/permissions";
import type { AuthContext } from "../auth/session";
import { AppError } from "../http/errors";

/** Who is performing an admin action, for permission checks and the audit trail. */
export type Actor = { auth: AuthContext; ip?: string | null; userAgent?: string | null };

export const orgOf = (a: Actor) => a.auth.user.organizationId;

export function auditMeta(a: Actor) {
  return { organizationId: orgOf(a), actorUserId: a.auth.user.id, ip: a.ip, userAgent: a.userAgent };
}

export function requirePermission(a: Actor, permission: Permission, branchId?: string | null) {
  if (!can(a.auth.grants, permission, branchId)) throw new AppError("forbidden", { permission });
}

/** Throws unless the actor holds the permission organization-wide (not only for some branches). */
export function requireOrgWide(a: Actor, permission: Permission) {
  if (branchesFor(a.auth.grants, permission) !== "all") throw new AppError("forbidden", { permission, scope: "organization" });
}

/** Branch ids the actor may act on for a permission; "all" for organization-wide grants. */
export function allowedBranches(a: Actor, permission: Permission): "all" | string[] {
  return branchesFor(a.auth.grants, permission);
}

export function actorPermissions(a: Actor): Set<string> {
  return new Set(a.auth.grants.flatMap((g) => g.permissions));
}

/** Prevents privilege escalation: nobody may grant permissions they do not hold themselves. */
export function assertCanGrant(a: Actor, permissions: readonly string[]) {
  const mine = actorPermissions(a);
  const missing = permissions.filter((p) => !mine.has(p));
  if (missing.length) throw new AppError("forbidden", { reason: "escalation", missing });
}

/** City ids the actor may use a permission in; "all" for organization-wide grants. */
export function allowedCities(a: Actor, permission: Permission): "all" | string[] {
  return citiesFor(a.auth.grants, permission);
}

/** Throws unless the actor holds the permission for the whole city (organization-wide or a grant on that city). */
export function requireCityAccess(a: Actor, permission: Permission, cityId: string) {
  if (!canInCity(a.auth.grants, permission, cityId)) throw new AppError("forbidden", { permission, cityId });
}
