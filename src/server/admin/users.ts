import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  agentGroupMembers,
  agentProfiles,
  branches,
  desks,
  passwordResetTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { looseNameMatch, normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { localizedText, uuid } from "@/domain/validation";
import { LOCALE_CODES } from "@/i18n/locales";
import { audit } from "../audit";
import { assertPasswordAcceptable, normalizeEmail } from "../auth/service";
import { hashPassword } from "../auth/password";
import { invalidateUserSessions } from "../auth/session";
import { randomToken, sha256Hex } from "../crypto";
import { AppError } from "../http/errors";
import { appLink } from "../links";
import { enqueue } from "../jobs";
import { allowedBranches, assertCanGrant, auditMeta, orgOf, requirePermission, type Actor } from "./actor";

export const grantInput = z.object({ roleId: uuid, branchId: uuid.nullable() });

export const agentInput = z.object({
  branchId: uuid,
  defaultDeskId: uuid.nullable().optional(),
  maxConcurrent: z.number().int().min(1).max(20).default(1),
  weight: z.number().int().min(1).max(100).default(1),
});

export const userInput = z.object({
  email: z.string().trim().email().max(320),
  displayName: localizedText({ max: 120 }),
  phone: z.string().trim().max(30).nullable().optional(),
  locale: z
    .enum(LOCALE_CODES as [string, ...string[]])
    .nullable()
    .optional(),
  grants: z.array(grantInput).max(50),
  agent: agentInput.nullable().optional(),
  groupIds: z.array(uuid).max(50).optional(),
});

export const createUserInput = userInput.extend({ password: z.string().max(256).optional() });

export type UserView = {
  id: string;
  email: string;
  displayName: Record<string, string>;
  phone: string | null;
  locale: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  createdAt: Date;
  grants: { roleId: string; branchId: string | null }[];
  agent: z.infer<typeof agentInput> | null;
  groupIds: string[];
};

function nameSearch(displayName: Record<string, string>, email: string) {
  return normalizeArabic([...Object.values(displayName), email.split("@")[0]].join(" "));
}

export async function listUsers(
  actor: Actor,
  filter: { q?: string; roleId?: string; branchId?: string; status?: string } = {},
): Promise<UserView[]> {
  requirePermission(actor, "users.view");
  const org = orgOf(actor);
  const scope = allowedBranches(actor, "users.view");

  const rows = await db()
    .select()
    .from(users)
    .where(and(eq(users.organizationId, org), isNull(users.archivedAt)))
    .orderBy(asc(users.createdAt));
  const ids = rows.map((u) => u.id);
  if (!ids.length) return [];
  const [grants, profiles, members] = await Promise.all([
    db().select().from(userRoles).where(inArray(userRoles.userId, ids)),
    db().select().from(agentProfiles).where(inArray(agentProfiles.userId, ids)),
    db().select().from(agentGroupMembers).where(inArray(agentGroupMembers.userId, ids)),
  ]);

  let result: UserView[] = rows.map((u) => {
    const p = profiles.find((x) => x.userId === u.id);
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      phone: u.phone,
      locale: u.locale,
      isActive: u.isActive,
      totpEnabled: !!u.totpEnabledAt,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      createdAt: u.createdAt,
      grants: grants.filter((g) => g.userId === u.id).map((g) => ({ roleId: g.roleId, branchId: g.branchId })),
      agent: p
        ? { branchId: p.branchId, defaultDeskId: p.defaultDeskId, maxConcurrent: p.maxConcurrent, weight: p.weight }
        : null,
      groupIds: members.filter((m) => m.userId === u.id).map((m) => m.groupId),
    };
  });

  if (scope !== "all") {
    result = result.filter(
      (u) => u.grants.some((g) => g.branchId && scope.includes(g.branchId)) || (u.agent && scope.includes(u.agent.branchId)),
    );
  }
  if (filter.q) {
    const q = filter.q;
    const byId = new Map(rows.map((r) => [r.id, r]));
    result = result.filter((u) => {
      const row = byId.get(u.id)!;
      return (
        row.nameSearch.includes(normalizeArabic(q)) ||
        u.email.includes(q.toLowerCase()) ||
        Object.values(u.displayName).some((n) => looseNameMatch(n, q))
      );
    });
  }
  if (filter.roleId) result = result.filter((u) => u.grants.some((g) => g.roleId === filter.roleId));
  if (filter.branchId)
    result = result.filter(
      (u) => u.grants.some((g) => g.branchId === filter.branchId || g.branchId === null) || u.agent?.branchId === filter.branchId,
    );
  if (filter.status === "active") result = result.filter((u) => u.isActive);
  if (filter.status === "inactive") result = result.filter((u) => !u.isActive);
  return result;
}

async function loadUser(actor: Actor, id: string, tx: DbOrTx = db()) {
  const [u] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, orgOf(actor)), isNull(users.archivedAt)));
  if (!u) throw new AppError("not_found");
  return u;
}

/**
 * Validates and merges role grants. Grants the actor cannot manage (other branches) are preserved untouched;
 * submitting such a grant, or a role with permissions the actor lacks, is refused.
 */
async function resolveGrants(tx: DbOrTx, actor: Actor, userId: string | null, submitted: z.infer<typeof grantInput>[]) {
  const scope = allowedBranches(actor, "users.manage");
  const manageable = (branchId: string | null) => scope === "all" || (branchId !== null && scope.includes(branchId));

  const roleIds = [...new Set(submitted.map((g) => g.roleId))];
  const branchIds = [...new Set(submitted.map((g) => g.branchId).filter((b): b is string => !!b))];
  const [roleRows, permRows, branchRows] = await Promise.all([
    roleIds.length
      ? tx
          .select()
          .from(roles)
          .where(and(inArray(roles.id, roleIds), eq(roles.organizationId, orgOf(actor)), isNull(roles.archivedAt)))
      : [],
    roleIds.length ? tx.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds)) : [],
    branchIds.length
      ? tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(inArray(branches.id, branchIds), eq(branches.organizationId, orgOf(actor))))
      : [],
  ]);
  if (roleRows.length !== roleIds.length || branchRows.length !== branchIds.length)
    throw new AppError("validation", { field: "grants" });

  for (const g of submitted) {
    if (!manageable(g.branchId)) throw new AppError("forbidden", { reason: "branch_scope", branchId: g.branchId });
    assertCanGrant(
      actor,
      permRows.filter((p) => p.roleId === g.roleId).map((p) => p.permissionKey),
    );
  }

  const existing = userId ? await tx.select().from(userRoles).where(eq(userRoles.userId, userId)) : [];
  const kept = existing.filter((g) => !manageable(g.branchId)).map((g) => ({ roleId: g.roleId, branchId: g.branchId }));
  const seen = new Set<string>();
  return [...kept, ...submitted].filter((g) => {
    const k = `${g.roleId}:${g.branchId ?? "*"}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** At least one active user must keep organization-wide admin access, or nobody can administer the system. */
async function assertAdminRemains(tx: Tx, organizationId: string) {
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, "roles.manage")))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.isActive, true),
        isNull(users.archivedAt),
        isNull(roles.archivedAt),
        isNull(userRoles.branchId),
      ),
    )
    .limit(1);
  if (!rows.length) throw new AppError("conflict", { reason: "last_admin" });
}

async function writeAgentAndGroups(tx: Tx, actor: Actor, userId: string, input: z.infer<typeof userInput>) {
  if (input.agent !== undefined) {
    if (input.agent === null) {
      await tx.delete(agentProfiles).where(eq(agentProfiles.userId, userId));
    } else {
      requirePermission(actor, "users.manage", input.agent.branchId);
      if (input.agent.defaultDeskId) {
        const [d] = await tx
          .select({ branchId: desks.branchId })
          .from(desks)
          .where(and(eq(desks.id, input.agent.defaultDeskId), isNull(desks.archivedAt)));
        if (!d || d.branchId !== input.agent.branchId) throw new AppError("validation", { field: "agent.defaultDeskId" });
      }
      const values = {
        branchId: input.agent.branchId,
        defaultDeskId: input.agent.defaultDeskId ?? null,
        maxConcurrent: input.agent.maxConcurrent,
        weight: input.agent.weight,
      };
      await tx
        .insert(agentProfiles)
        .values({ userId, organizationId: orgOf(actor), ...values })
        .onConflictDoUpdate({ target: agentProfiles.userId, set: values });
    }
  }
  if (input.groupIds) {
    await tx.delete(agentGroupMembers).where(eq(agentGroupMembers.userId, userId));
    if (input.groupIds.length) await tx.insert(agentGroupMembers).values(input.groupIds.map((groupId) => ({ groupId, userId })));
  }
}

async function createResetLink(
  tx: DbOrTx,
  userId: string,
  locale: string,
  hours = 72,
): Promise<{ link: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await tx.insert(passwordResetTokens).values({ userId, tokenHash: sha256Hex(token), expiresAt });
  return { link: appLink(`/reset-password/${token}`, locale), expiresAt };
}

export async function createUser(
  actor: Actor,
  input: z.infer<typeof createUserInput>,
): Promise<{ id: string; setPasswordLink?: string }> {
  requirePermission(actor, "users.manage");
  const org = orgOf(actor);
  const email = normalizeEmail(input.email);
  if (input.password) await assertPasswordAcceptable(org, input.password, email);
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  return db().transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org), eq(users.email, email)));
    if (dup) throw new AppError("conflict", { field: "email" });
    const grants = await resolveGrants(tx, actor, null, input.grants);
    const [u] = await tx
      .insert(users)
      .values({
        organizationId: org,
        email,
        displayName: input.displayName,
        nameSearch: nameSearch(input.displayName, email),
        phone: input.phone ?? null,
        locale: input.locale ?? null,
        passwordHash,
        passwordChangedAt: passwordHash ? new Date() : null,
      })
      .returning();
    if (grants.length) await tx.insert(userRoles).values(grants.map((g) => ({ ...g, userId: u.id })));
    await writeAgentAndGroups(tx, actor, u.id, input);
    await audit({ ...auditMeta(actor), action: "user.created", entityType: "user", entityId: u.id, after: { ...u, grants } }, tx);
    if (passwordHash) return { id: u.id };
    const { link } = await createResetLink(tx, u.id, input.locale ?? "ar");
    return { id: u.id, setPasswordLink: link };
  });
}

export async function updateUser(actor: Actor, id: string, input: z.infer<typeof userInput>): Promise<void> {
  requirePermission(actor, "users.manage");
  const before = await loadUser(actor, id);
  const email = normalizeEmail(input.email);
  await db().transaction(async (tx) => {
    if (email !== before.email) {
      const [dup] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.organizationId, before.organizationId), eq(users.email, email)));
      if (dup) throw new AppError("conflict", { field: "email" });
    }
    const beforeGrants = await tx.select().from(userRoles).where(eq(userRoles.userId, id));
    const grants = await resolveGrants(tx, actor, id, input.grants);
    await tx
      .update(users)
      .set({
        email,
        displayName: input.displayName,
        nameSearch: nameSearch(input.displayName, email),
        phone: input.phone ?? null,
        locale: input.locale ?? null,
      })
      .where(eq(users.id, id));
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    if (grants.length) await tx.insert(userRoles).values(grants.map((g) => ({ ...g, userId: id })));
    await writeAgentAndGroups(tx, actor, id, input);
    await assertAdminRemains(tx, before.organizationId);
    await audit(
      {
        ...auditMeta(actor),
        action: "user.updated",
        entityType: "user",
        entityId: id,
        before: { ...before, grants: beforeGrants.map((g) => ({ roleId: g.roleId, branchId: g.branchId })) },
        after: { ...input, email, grants },
      },
      tx,
    );
  });
}

export async function setUserActive(actor: Actor, id: string, active: boolean): Promise<void> {
  requirePermission(actor, "users.manage");
  if (!active && id === actor.auth.user.id) throw new AppError("conflict", { reason: "self" });
  const before = await loadUser(actor, id);
  await db().transaction(async (tx) => {
    await tx.update(users).set({ isActive: active, lockedUntil: null, failedLoginCount: 0 }).where(eq(users.id, id));
    if (!active) {
      await invalidateUserSessions(id, tx);
      await tx.update(agentProfiles).set({ status: "OFFLINE", statusChangedAt: new Date() }).where(eq(agentProfiles.userId, id));
    }
    await assertAdminRemains(tx, before.organizationId);
    await audit(
      { ...auditMeta(actor), action: active ? "user.activated" : "user.deactivated", entityType: "user", entityId: id },
      tx,
    );
  });
}

export async function forceLogout(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "users.manage");
  await loadUser(actor, id);
  await invalidateUserSessions(id);
  await audit({ ...auditMeta(actor), action: "user.force_logout", entityType: "user", entityId: id });
}

export async function resetTwoFactor(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "users.manage");
  await loadUser(actor, id);
  await db().transaction(async (tx) => {
    await tx.update(users).set({ totpSecretEnc: null, totpEnabledAt: null }).where(eq(users.id, id));
    await invalidateUserSessions(id, tx);
    await audit({ ...auditMeta(actor), action: "user.totp_reset", entityType: "user", entityId: id }, tx);
  });
}

/** Creates a single-use password reset link, signs the user out, and optionally emails the link. */
export async function issuePasswordReset(
  actor: Actor,
  id: string,
  opts: { sendEmail: boolean },
): Promise<{ link: string; expiresAt: Date; emailQueued: boolean }> {
  requirePermission(actor, "users.manage");
  const u = await loadUser(actor, id);
  const result = await db().transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, id), isNull(passwordResetTokens.usedAt)));
    const r = await createResetLink(tx, id, u.locale ?? "ar", 24);
    await invalidateUserSessions(id, tx);
    await audit({ ...auditMeta(actor), action: "user.password_reset_issued", entityType: "user", entityId: id }, tx);
    return r;
  });
  if (opts.sendEmail) {
    await enqueue("messages.send", {
      organizationId: u.organizationId,
      userId: u.id,
      channel: "email",
      event: "password_reset",
      to: u.email,
      locale: u.locale ?? "ar",
      vars: {
        name: u.displayName[u.locale ?? "ar"] ?? u.email,
        link: result.link,
        expires: result.expiresAt.toISOString().slice(0, 16).replace("T", " "),
      },
    });
  }
  return { ...result, emailQueued: opts.sendEmail };
}

/** Public: validates a reset token. */
async function findResetToken(token: string) {
  const [row] = await db()
    .select({ t: passwordResetTokens, u: users })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, sha256Hex(token)));
  if (!row || row.t.usedAt || row.t.expiresAt < new Date() || !row.u.isActive || row.u.archivedAt) return null;
  return row;
}

export async function describeResetToken(token: string) {
  const row = await findResetToken(token);
  return row ? { email: row.u.email, displayName: row.u.displayName } : null;
}

export async function completePasswordReset(
  token: string,
  password: string,
  client: { ip?: string | null; userAgent?: string | null },
) {
  const row = await findResetToken(token);
  if (!row) throw new AppError("not_found", { reason: "invalid_or_expired" });
  await assertPasswordAcceptable(row.u.organizationId, password, row.u.email);
  const passwordHash = await hashPassword(password);
  await db().transaction(async (tx) => {
    const used = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.t.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (!used.length) throw new AppError("not_found", { reason: "invalid_or_expired" });
    await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, row.u.id));
    await invalidateUserSessions(row.u.id, tx);
    await audit(
      {
        organizationId: row.u.organizationId,
        actorUserId: row.u.id,
        action: "user.password_reset_completed",
        entityType: "user",
        entityId: row.u.id,
        ...client,
      },
      tx,
    );
  });
  return { userId: row.u.id };
}

/** Lookup used by admin pickers: active users that have an agent profile. */
export async function listAgents(actor: Actor) {
  requirePermission(actor, "reasons.view");
  const scope = allowedBranches(actor, "reasons.view");
  if (scope !== "all" && scope.length === 0) return [];
  const rows = await db()
    .select({ id: users.id, displayName: users.displayName, email: users.email, branchId: agentProfiles.branchId })
    .from(agentProfiles)
    .innerJoin(users, eq(users.id, agentProfiles.userId))
    .where(
      and(
        eq(users.organizationId, orgOf(actor)),
        isNull(users.archivedAt),
        eq(users.isActive, true),
        scope === "all" ? undefined : or(...scope.map((b) => eq(agentProfiles.branchId, b))),
      ),
    )
    .orderBy(asc(users.createdAt));
  return rows;
}
