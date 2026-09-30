import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { permissions, rolePermissions, roles, userRoles } from "@/db/schema";
import { PERMISSION_GROUPS, SYSTEM_ROLES, type SystemRoleKey } from "@/domain/rbac/permissions";
import { LOCALE_CODES } from "@/i18n/locales";

type Messages = { permissions: Record<string, Record<string, string>> };

function labels(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of LOCALE_CODES) {
    const msgs = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
    for (const [area, actions] of Object.entries(msgs.permissions)) {
      for (const [action, text] of Object.entries(actions)) (out[`${area}.${action}`] ??= {})[locale] = text;
    }
  }
  return out;
}

/** Upserts the permission catalogue and keeps built-in roles in sync with code. Runs on every seed. */
export async function syncPermissions(tx: DbOrTx, organizationId: string) {
  const text = labels();
  for (const [group, keys] of Object.entries(PERMISSION_GROUPS)) {
    for (const key of keys) {
      await tx
        .insert(permissions)
        .values({ key, group, description: text[key] ?? { en: key } })
        .onConflictDoUpdate({ target: permissions.key, set: { group, description: text[key] ?? { en: key } } });
    }
  }

  const roleNames: Record<SystemRoleKey, Record<string, string>> = {
    super_admin: { ar: "المسؤول العام", en: "Super admin" },
    admin: { ar: "مسؤول المدينة", en: "City admin" },
    receptionist: { ar: "موظف استقبال", en: "Receptionist" },
    agent: { ar: "موظف خدمة", en: "Agent" },
  };
  // Before cities existed the "admin" role was organization-wide. Those people become super admins (once, when the
  // super admin role is first created) so nobody loses access; the admin role is then used per city.
  const [hadSuperAdmin] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "super_admin")));
  for (const [key, perms] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, string[]][]) {
    const [role] = await tx
      .insert(roles)
      .values({ organizationId, key, name: roleNames[key], isSystem: true })
      .onConflictDoUpdate({ target: [roles.organizationId, roles.key], set: { isSystem: true } })
      .returning();
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, role.id), notInArray(rolePermissions.permissionKey, perms)));
    const existing = await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, role.id), inArray(rolePermissions.permissionKey, perms)));
    const have = new Set(existing.map((e) => e.key));
    const missing = perms.filter((p) => !have.has(p));
    if (missing.length)
      await tx.insert(rolePermissions).values(missing.map((permissionKey) => ({ roleId: role.id, permissionKey })));
  }
  if (!hadSuperAdmin) {
    const [superAdmin] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "super_admin")));
    const [admin] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.key, "admin")));
    if (superAdmin && admin) {
      const wide = await tx
        .select()
        .from(userRoles)
        .where(and(eq(userRoles.roleId, admin.id), isNull(userRoles.branchId), isNull(userRoles.cityId)));
      for (const g of wide) {
        await tx.insert(userRoles).values({ userId: g.userId, roleId: superAdmin.id }).onConflictDoNothing();
        await tx.delete(userRoles).where(eq(userRoles.id, g.id));
      }
    }
  }
}
