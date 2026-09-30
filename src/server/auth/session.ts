import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { branches, cities, rolePermissions, roles, sessions, userRoles, users } from "@/db/schema";
import { NO_BRANCH, type Grant } from "@/domain/rbac/permissions";
import { randomToken, sha256Hex } from "../crypto";
import { env } from "../env";

export const SESSION_COOKIE = "dor_session";

/** Sessions are extended when less than half of their lifetime remains (sliding expiry). */
const ttlMs = () => env().SESSION_TTL_HOURS * 3600_000;

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  displayName: Record<string, string>;
  locale: string | null;
  totpEnabled: boolean;
};

export type AuthContext = {
  sessionId: string;
  user: SessionUser;
  grants: Grant[];
  /** False while the TOTP step is outstanding; such sessions may only call the 2FA endpoints. */
  twoFactorVerified: boolean;
  expiresAt: Date;
};

export async function createSession(
  userId: string,
  opts: { twoFactorVerified: boolean; ip?: string | null; userAgent?: string | null },
  tx: DbOrTx = db(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await tx.insert(sessions).values({
    id: sha256Hex(token),
    userId,
    expiresAt,
    twoFactorVerified: opts.twoFactorVerified,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent?.slice(0, 400) ?? null,
  });
  return { token, expiresAt };
}

export async function loadGrants(userId: string, tx: DbOrTx = db()): Promise<Grant[]> {
  const rows = await tx
    .select({
      branchId: userRoles.branchId,
      cityId: userRoles.cityId,
      roleId: userRoles.roleId,
      permission: rolePermissions.permissionKey,
    })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.archivedAt)))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const byGrant = new Map<string, { branchId: string | null; cityId: string | null; permissions: string[] }>();
  for (const r of rows) {
    const key = `${r.roleId}:${r.branchId ?? "*"}:${r.cityId ?? "*"}`;
    let g = byGrant.get(key);
    if (!g) byGrant.set(key, (g = { branchId: r.branchId, cityId: r.cityId, permissions: [] }));
    if (r.permission) g.permissions.push(r.permission);
  }

  // A city grant applies to every current branch of that (active) city, so branches added later are covered too.
  const cityIds = [...new Set([...byGrant.values()].map((g) => g.cityId).filter((c): c is string => !!c))];
  const cityBranches = new Map<string, string[]>();
  if (cityIds.length) {
    const live = await tx
      .select({ id: cities.id })
      .from(cities)
      .where(and(inArray(cities.id, cityIds), isNull(cities.archivedAt)));
    for (const c of live) cityBranches.set(c.id, []);
    const bs = await tx
      .select({ id: branches.id, cityId: branches.cityId })
      .from(branches)
      .where(and(inArray(branches.cityId, cityIds), isNull(branches.archivedAt)));
    for (const b of bs) cityBranches.get(b.cityId)?.push(b.id);
  }

  const out: Grant[] = [];
  for (const g of byGrant.values()) {
    if (!g.cityId) {
      out.push({ branchId: g.branchId, permissions: g.permissions });
      continue;
    }
    const list = cityBranches.get(g.cityId);
    if (!list) continue; // archived city: the grant is dormant
    for (const branchId of list.length ? list : [NO_BRANCH]) out.push({ branchId, cityId: g.cityId, permissions: g.permissions });
  }
  return out;
}

/** Validates a raw cookie token. Returns null for unknown, expired, or deactivated users. */
export async function validateSessionToken(token: string): Promise<AuthContext | null> {
  const sessionId = sha256Hex(token);
  const [row] = await db()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.user.isActive || row.user.archivedAt) return null;

  let expiresAt = row.session.expiresAt;
  const now = Date.now();
  const updates: Partial<typeof sessions.$inferInsert> = {};
  if (expiresAt.getTime() - now < ttlMs() / 2) {
    expiresAt = new Date(now + ttlMs());
    updates.expiresAt = expiresAt;
  }
  if (now - row.session.lastSeenAt.getTime() > 60_000) updates.lastSeenAt = new Date(now);
  if (Object.keys(updates).length) await db().update(sessions).set(updates).where(eq(sessions.id, sessionId));

  return {
    sessionId,
    twoFactorVerified: row.session.twoFactorVerified,
    expiresAt,
    grants: await loadGrants(row.user.id),
    user: {
      id: row.user.id,
      organizationId: row.user.organizationId,
      email: row.user.email,
      displayName: row.user.displayName,
      locale: row.user.locale,
      totpEnabled: !!row.user.totpEnabledAt,
    },
  };
}

export async function markSessionTwoFactorVerified(sessionId: string): Promise<void> {
  await db().update(sessions).set({ twoFactorVerified: true }).where(eq(sessions.id, sessionId));
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.id, sessionId));
}

/** Force logout everywhere (admin action, password change, deactivation). */
export async function invalidateUserSessions(userId: string, tx: DbOrTx = db()): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}
