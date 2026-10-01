import { and, eq, exists, isNull, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { getSetting } from "../settings/service";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: boolean }>();

/** Forgets cached answers (after a role change, and between tests). */
export function resetReceptionCache(branchId?: string) {
  if (branchId) cache.delete(branchId);
  else cache.clear();
}

/**
 * Does the branch have a receptionist? True when an active user holds a reception role (a role that can issue tickets
 * but is not an administrator role) on the branch itself, on its city, or organization-wide. Administrators do not
 * count: they are not at the desk. Cached for about a minute. See D61.
 */
export async function branchHasReception(branchId: string): Promise<boolean> {
  const hit = cache.get(branchId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [b] = await db().select({ cityId: branches.cityId }).from(branches).where(eq(branches.id, branchId));
  let value = false;
  if (b) {
    const has = (key: string) =>
      exists(
        db()
          .select({ one: sql`1` })
          .from(rolePermissions)
          .where(and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, key))),
      );
    const rows = await db()
      .select({ id: userRoles.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          isNull(roles.archivedAt),
          eq(users.isActive, true),
          isNull(users.archivedAt),
          has("tickets.issue"),
          notExists(
            db()
              .select({ one: sql`1` })
              .from(rolePermissions)
              .where(and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, "admin.access"))),
          ),
          or(
            eq(userRoles.branchId, branchId),
            eq(userRoles.cityId, b.cityId),
            and(isNull(userRoles.branchId), isNull(userRoles.cityId)),
          ),
        ),
      )
      .limit(1);
    value = rows.length > 0;
  }
  cache.set(branchId, { at: Date.now(), value });
  return value;
}

export type AgentIssuingState = {
  mode: "off" | "when_no_reception" | "always";
  hasReception: boolean;
  /** Agents of this branch may issue walk-in tickets right now. */
  allowed: boolean;
};

/** Resolved `reception.agentIssuing` for a branch (inherits the city and branch overrides) and whether it applies now. */
export async function agentIssuingState(organizationId: string, branchId: string): Promise<AgentIssuingState> {
  const { agentIssuing: mode } = await getSetting(organizationId, "reception", branchId);
  if (mode === "off") return { mode, hasReception: await branchHasReception(branchId), allowed: false };
  const hasReception = await branchHasReception(branchId);
  return { mode, hasReception, allowed: mode === "always" || !hasReception };
}
