import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { rolePermissions, roles, userRoles, users } from "@/db/schema";
import { ALL_PERMISSIONS } from "@/domain/rbac/permissions";
import { localizedText } from "@/domain/validation";
import { randomCode } from "../crypto";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { assertCanGrant, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const roleInput = z.object({
  name: localizedText({ max: 80 }),
  description: localizedText({ max: 300, required: false }).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length),
});
export type RoleInput = z.infer<typeof roleInput>;

export type RoleView = {
  id: string;
  key: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
};

export async function listRoles(actor: Actor): Promise<RoleView[]> {
  requirePermission(actor, "roles.view");
  const org = orgOf(actor);
  const [rows, perms, counts] = await Promise.all([
    db()
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, org), isNull(roles.archivedAt)))
      .orderBy(asc(roles.createdAt)),
    db()
      .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(eq(roles.organizationId, org)),
    db()
      .select({ roleId: userRoles.roleId, n: count() })
      .from(userRoles)
      .innerJoin(users, and(eq(users.id, userRoles.userId), isNull(users.archivedAt)))
      .where(eq(users.organizationId, org))
      .groupBy(userRoles.roleId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.key),
    userCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
  }));
}

async function loadRole(actor: Actor, id: string) {
  const [role] = await db()
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.organizationId, orgOf(actor)), isNull(roles.archivedAt)));
  if (!role) throw new AppError("not_found");
  return role;
}

export async function createRole(actor: Actor, input: RoleInput): Promise<{ id: string }> {
  requireOrgWide(actor, "roles.manage");
  assertCanGrant(actor, input.permissions);
  return db().transaction(async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({
        organizationId: orgOf(actor),
        key: `custom_${randomCode(8).toLowerCase()}`,
        name: input.name,
        description: input.description ?? null,
      })
      .returning();
    if (input.permissions.length) {
      await tx.insert(rolePermissions).values(input.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })));
    }
    await audit(
      {
        ...auditMeta(actor),
        action: "role.created",
        entityType: "role",
        entityId: role.id,
        after: { ...role, permissions: input.permissions },
      },
      tx,
    );
    return { id: role.id };
  });
}

export async function updateRole(actor: Actor, id: string, input: RoleInput): Promise<void> {
  requireOrgWide(actor, "roles.manage");
  const role = await loadRole(actor, id);
  // Built-in roles are defined in code and re-synced on every seed; clone them to customise.
  if (role.isSystem) throw new AppError("conflict", { reason: "system_role" });
  assertCanGrant(actor, input.permissions);
  await db().transaction(async (tx) => {
    const before = await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id));
    await tx
      .update(roles)
      .set({ name: input.name, description: input.description ?? null })
      .where(eq(roles.id, id));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (input.permissions.length) {
      await tx.insert(rolePermissions).values(input.permissions.map((permissionKey) => ({ roleId: id, permissionKey })));
    }
    await audit(
      {
        ...auditMeta(actor),
        action: "role.updated",
        entityType: "role",
        entityId: id,
        before: { name: role.name, description: role.description, permissions: before.map((b) => b.key) },
        after: input,
      },
      tx,
    );
  });
}

export async function cloneRole(actor: Actor, id: string, name: Record<string, string>): Promise<{ id: string }> {
  const source = (await listRoles(actor)).find((r) => r.id === id);
  if (!source) throw new AppError("not_found");
  return createRole(actor, { name, description: source.description ?? undefined, permissions: source.permissions });
}

export async function archiveRole(actor: Actor, id: string): Promise<void> {
  requireOrgWide(actor, "roles.manage");
  const role = await loadRole(actor, id);
  if (role.isSystem) throw new AppError("conflict", { reason: "system_role" });
  const [{ n }] = await db().select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, id));
  if (n > 0) throw new AppError("conflict", { reason: "role_in_use", users: n });
  await db().transaction(async (tx) => {
    await tx.update(roles).set({ archivedAt: new Date() }).where(eq(roles.id, id));
    await audit({ ...auditMeta(actor), action: "role.archived", entityType: "role", entityId: id, before: role }, tx);
  });
}
