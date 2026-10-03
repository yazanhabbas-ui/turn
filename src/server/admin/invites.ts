import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { agentProfiles, branches, invites, organizations, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { localizedText, uuid } from "@/domain/validation";
import { LOCALE_CODES, pickText } from "@/i18n/locales";
import { audit } from "../audit";
import { hashPassword } from "../auth/password";
import { assertPasswordAcceptable, normalizeEmail } from "../auth/service";
import { createSession } from "../auth/session";
import { randomToken, sha256Hex } from "../crypto";
import { AppError } from "../http/errors";
import { enqueue } from "../jobs";
import { appLink } from "../links";
import { providerFor } from "../messaging/providers";
import { getSetting } from "../settings/service";
import { allowedBranches, assertCanGrant, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export const INVITE_CHANNELS = ["email", "whatsapp", "sms"] as const;

export const inviteInput = z
  .object({
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().max(30).optional(),
    displayName: localizedText({ max: 120, required: false }).optional(),
    roleId: uuid,
    branchId: uuid.nullable(),
    channels: z.array(z.enum(INVITE_CHANNELS)).max(3).default([]),
    locale: z.enum(LOCALE_CODES as [string, ...string[]]).default("ar"),
  })
  .refine((v) => v.email || v.phone, { message: "email_or_phone" });

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

function statusOf(i: typeof invites.$inferSelect): InviteStatus {
  if (i.revokedAt) return "revoked";
  if (i.usedAt) return "used";
  if (i.expiresAt < new Date()) return "expired";
  return "pending";
}

export async function listInvites(actor: Actor) {
  requirePermission(actor, "users.invite");
  const scope = allowedBranches(actor, "users.invite");
  const rows = await db()
    .select({ invite: invites, roleName: roles.name })
    .from(invites)
    .innerJoin(roles, eq(roles.id, invites.roleId))
    .where(eq(invites.organizationId, orgOf(actor)))
    .orderBy(desc(invites.createdAt))
    .limit(200);
  return rows
    .filter(({ invite: i }) => scope === "all" || (i.branchId !== null && scope.includes(i.branchId)))
    .map(({ invite: i, roleName }) => ({
      id: i.id,
      email: i.email,
      phone: i.phone,
      displayName: i.displayName,
      roleId: i.roleId,
      roleName,
      branchId: i.branchId,
      channel: i.channel,
      locale: i.locale,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      createdAt: i.createdAt,
      status: statusOf(i),
    }));
}

export async function roleForInvite(actor: Actor, roleId: string) {
  const [role] = await db()
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.organizationId, orgOf(actor)), isNull(roles.archivedAt)));
  if (!role) throw new AppError("validation", { field: "roleId" });
  const perms = await db()
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  assertCanGrant(
    actor,
    perms.map((p) => p.key),
  );
  return role;
}

type Delivery = { channel: (typeof INVITE_CHANNELS)[number]; status: "queued" | "not_configured" };

async function deliver(
  invite: typeof invites.$inferSelect,
  link: string,
  roleName: Record<string, string>,
  channels: readonly (typeof INVITE_CHANNELS)[number][],
): Promise<Delivery[]> {
  const [org] = await db()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.organizationId));
  const vars = {
    name: pickText(invite.displayName, invite.locale, invite.email ?? ""),
    company: pickText(org?.name, invite.locale),
    role: pickText(roleName, invite.locale),
    link,
    expires: invite.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC",
  };
  const out: Delivery[] = [];
  for (const channel of channels) {
    const to = channel === "email" ? invite.email : invite.phone;
    if (!to) continue;
    if (!providerFor(channel)) {
      out.push({ channel, status: "not_configured" });
      continue;
    }
    await enqueue("messages.send", {
      organizationId: invite.organizationId,
      branchId: invite.branchId,
      channel,
      event: "invite",
      to,
      locale: invite.locale,
      vars,
    });
    out.push({ channel, status: "queued" });
  }
  return out;
}

/**
 * Creates a single-use invite. The link is always returned so the admin can copy it (fallback when no
 * email/WhatsApp provider is configured); only the token's hash is stored.
 */
export async function createInvite(actor: Actor, input: z.infer<typeof inviteInput>) {
  requirePermission(actor, "users.invite", input.branchId);
  const org = orgOf(actor);
  const role = await roleForInvite(actor, input.roleId);
  if (input.branchId) {
    const [b] = await db()
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.organizationId, org)));
    if (!b) throw new AppError("validation", { field: "branchId" });
  } else {
    // An invite with no branch grants organization-wide access.
    requireOrgWide(actor, "users.invite");
  }
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) {
    const [existing] = await db()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org), eq(users.email, email), isNull(users.archivedAt)));
    if (existing) throw new AppError("conflict", { field: "email" });
  }
  const { inviteExpiryHours } = await getSetting(org, "security");
  const token = randomToken();
  const [invite] = await db()
    .insert(invites)
    .values({
      organizationId: org,
      tokenHash: sha256Hex(token),
      email,
      phone: input.phone ?? null,
      displayName: input.displayName ?? null,
      roleId: role.id,
      branchId: input.branchId,
      channel: input.channels[0] ?? "link",
      locale: input.locale,
      expiresAt: new Date(Date.now() + inviteExpiryHours * 3600_000),
      createdByUserId: actor.auth.user.id,
    })
    .returning();
  const link = appLink(`/invite/${token}`, input.locale);
  const deliveries = await deliver(invite, link, role.name, input.channels);
  await audit({
    ...auditMeta(actor),
    branchId: input.branchId,
    action: "invite.created",
    entityType: "invite",
    entityId: invite.id,
    after: { ...invite, deliveries },
  });
  return { id: invite.id, link, expiresAt: invite.expiresAt, deliveries };
}

async function loadPendingInvite(actor: Actor, id: string) {
  const [i] = await db()
    .select()
    .from(invites)
    .where(and(eq(invites.id, id), eq(invites.organizationId, orgOf(actor))));
  if (!i) throw new AppError("not_found");
  requirePermission(actor, "users.invite", i.branchId);
  return i;
}

/** Issues a fresh token (the old link stops working) and extends the expiry. */
export async function resendInvite(actor: Actor, id: string, channels: readonly (typeof INVITE_CHANNELS)[number][]) {
  const before = await loadPendingInvite(actor, id);
  if (before.usedAt || before.revokedAt) throw new AppError("conflict", { reason: "not_pending" });
  const role = await roleForInvite(actor, before.roleId);
  const { inviteExpiryHours } = await getSetting(before.organizationId, "security");
  const token = randomToken();
  const [invite] = await db()
    .update(invites)
    .set({ tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + inviteExpiryHours * 3600_000) })
    .where(eq(invites.id, id))
    .returning();
  const link = appLink(`/invite/${token}`, invite.locale);
  const deliveries = await deliver(invite, link, role.name, channels);
  await audit({
    ...auditMeta(actor),
    branchId: invite.branchId,
    action: "invite.resent",
    entityType: "invite",
    entityId: id,
    after: { deliveries },
  });
  return { id, link, expiresAt: invite.expiresAt, deliveries };
}

export async function revokeInvite(actor: Actor, id: string) {
  const before = await loadPendingInvite(actor, id);
  if (before.usedAt) throw new AppError("conflict", { reason: "already_used" });
  await db().update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: before.branchId,
    action: "invite.revoked",
    entityType: "invite",
    entityId: id,
    before,
  });
}

async function findValidInvite(token: string) {
  const [row] = await db()
    .select({ invite: invites, roleName: roles.name, orgName: organizations.name })
    .from(invites)
    .innerJoin(roles, eq(roles.id, invites.roleId))
    .innerJoin(organizations, eq(organizations.id, invites.organizationId))
    .where(
      and(
        eq(invites.tokenHash, sha256Hex(token)),
        isNull(invites.usedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** Public: what the invite page shows before the person sets a password. */
export async function describeInvite(token: string) {
  const row = await findValidInvite(token);
  if (!row) return null;
  return {
    email: row.invite.email,
    displayName: row.invite.displayName,
    roleName: row.roleName,
    organizationName: row.orgName,
    locale: row.invite.locale,
    expiresAt: row.invite.expiresAt,
  };
}


export type ProvisionInput = {
  organizationId: string;
  email: string;
  displayName: Record<string, string>;
  phone: string | null;
  locale: string;
  passwordHash: string;
  roleId: string;
  branchId: string | null;
};

/**
 * Creates a staff account with one role grant. Roles that serve visitors also get an agent profile in the given branch
 * (or the default branch). Shared by invite acceptance and approval of a sign-up request.
 */
export async function provisionUser(tx: Tx, p: ProvisionInput) {
  const [u] = await tx
    .insert(users)
    .values({
      organizationId: p.organizationId,
      email: p.email,
      displayName: p.displayName,
      nameSearch: normalizeArabic([...Object.values(p.displayName), p.email.split("@")[0]].join(" ")),
      phone: p.phone,
      locale: p.locale,
      passwordHash: p.passwordHash,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(),
    })
    .returning();
  await tx.insert(userRoles).values({ userId: u.id, roleId: p.roleId, branchId: p.branchId });
  const serves = await tx
    .select({ k: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, p.roleId), eq(rolePermissions.permissionKey, "agent.serve")));
  if (serves.length) {
    const [branch] = p.branchId
      ? [{ id: p.branchId }]
      : await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.organizationId, p.organizationId), isNull(branches.archivedAt)))
          .orderBy(desc(branches.isDefault))
          .limit(1);
    if (branch) await tx.insert(agentProfiles).values({ userId: u.id, organizationId: p.organizationId, branchId: branch.id });
  }
  return u;
}

export const acceptInviteInput = z.object({
  email: z.string().trim().email().max(320).optional(),
  displayName: localizedText({ max: 120 }),
  password: z.string().min(1).max(256),
});

/**
 * Public: accepts an invite. Creates the user with the preselected role and branch, marks the invite used
 * (single use, enforced atomically), and signs the new user in.
 */
export async function acceptInvite(
  token: string,
  input: z.infer<typeof acceptInviteInput>,
  client: { ip?: string | null; userAgent?: string | null },
) {
  const row = await findValidInvite(token);
  if (!row) throw new AppError("not_found", { reason: "invalid_or_expired" });
  const inv = row.invite;
  const email = inv.email ?? (input.email ? normalizeEmail(input.email) : null);
  if (!email) throw new AppError("validation", { field: "email" });
  await assertPasswordAcceptable(inv.organizationId, input.password, email);
  const passwordHash = await hashPassword(input.password);

  return db().transaction(async (tx) => {
    const claimed = await tx
      .update(invites)
      .set({ usedAt: new Date() })
      .where(and(eq(invites.id, inv.id), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
      .returning({ id: invites.id });
    if (!claimed.length) throw new AppError("not_found", { reason: "invalid_or_expired" });

    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, inv.organizationId), eq(users.email, email)));
    if (dup) throw new AppError("conflict", { field: "email" });

    const u = await provisionUser(tx, {
      organizationId: inv.organizationId,
      email,
      displayName: input.displayName,
      phone: inv.phone,
      locale: inv.locale,
      passwordHash,
      roleId: inv.roleId,
      branchId: inv.branchId,
    });
    await tx.update(invites).set({ usedByUserId: u.id }).where(eq(invites.id, inv.id));
    await audit(
      {
        organizationId: inv.organizationId,
        branchId: inv.branchId,
        actorUserId: u.id,
        action: "invite.accepted",
        entityType: "invite",
        entityId: inv.id,
        after: { userId: u.id },
        ...client,
      },
      tx,
    );
    const session = await createSession(u.id, { twoFactorVerified: true, ...client }, tx);
    return { userId: u.id, ...session };
  });
}
