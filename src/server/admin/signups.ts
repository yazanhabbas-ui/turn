import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, organizations, signupRequests, users } from "@/db/schema";
import { localizedText, uuid } from "@/domain/validation";
import { LOCALE_CODES, pickText } from "@/i18n/locales";
import { audit } from "../audit";
import { hashPassword } from "../auth/password";
import { assertPasswordAcceptable, normalizeEmail } from "../auth/service";
import { AppError } from "../http/errors";
import { enqueue } from "../jobs";
import { appLink } from "../links";
import { providerFor } from "../messaging/providers";
import { getSetting } from "../settings/service";
import { auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";
import { provisionUser, roleForInvite } from "./invites";

export const signupInput = z.object({
  email: z.string().trim().email().max(320),
  displayName: localizedText({ max: 120 }),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(1).max(256),
  locale: z.enum(LOCALE_CODES as [string, ...string[]]).default("ar"),
  /** Organization slug; only needed when more than one organization accepts sign-ups. */
  organization: z.string().trim().max(80).optional(),
});

export const approveSignupInput = z.object({ roleId: uuid, branchId: uuid.nullable() });
export const rejectSignupInput = z.object({ reason: z.string().trim().max(500).optional() });

export type SignupStatus = "pending" | "approved" | "rejected";

/** Organizations that currently accept sign-up requests. */
async function openOrganizations(slug?: string) {
  const orgs = await db()
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations);
  const open = [];
  for (const o of orgs) {
    if (slug && o.slug !== slug) continue;
    if ((await getSetting(o.id, "security")).selfSignupEnabled) open.push(o);
  }
  return open;
}

/** Public: whether the sign-up page is available (used to show the link on the sign-in page). */
export async function signupAvailable(): Promise<boolean> {
  return (await openOrganizations()).length > 0;
}

/**
 * Public: records a sign-up request. The answer is the same whether or not the address already has an account or a
 * pending request, so the form cannot be used to find out who is registered.
 */
export async function requestSignup(
  input: z.infer<typeof signupInput>,
  client: { ip?: string | null; userAgent?: string | null },
) {
  const open = await openOrganizations(input.organization);
  if (!open.length) throw new AppError("not_found", { reason: "signup_disabled" });
  if (open.length > 1) throw new AppError("organization_required");
  const org = open[0];
  const email = normalizeEmail(input.email);
  await assertPasswordAcceptable(org.id, input.password, email);

  const [existing] = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, org.id), eq(users.email, email)));
  const [pending] = await db()
    .select({ id: signupRequests.id })
    .from(signupRequests)
    .where(and(eq(signupRequests.organizationId, org.id), eq(signupRequests.email, email), eq(signupRequests.status, "pending")));
  if (existing || pending) return { ok: true };

  const [req] = await db()
    .insert(signupRequests)
    .values({
      organizationId: org.id,
      email,
      displayName: input.displayName,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      locale: input.locale,
    })
    .returning({ id: signupRequests.id });
  await audit({
    organizationId: org.id,
    action: "signup.requested",
    entityType: "signup_request",
    entityId: req.id,
    after: { email },
    ...client,
  });
  return { ok: true };
}

export async function listSignups(actor: Actor) {
  requirePermission(actor, "users.invite");
  const rows = await db()
    .select({
      id: signupRequests.id,
      email: signupRequests.email,
      displayName: signupRequests.displayName,
      phone: signupRequests.phone,
      locale: signupRequests.locale,
      status: signupRequests.status,
      rejectReason: signupRequests.rejectReason,
      decidedAt: signupRequests.decidedAt,
      createdAt: signupRequests.createdAt,
    })
    .from(signupRequests)
    .where(eq(signupRequests.organizationId, orgOf(actor)))
    .orderBy(desc(signupRequests.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, status: r.status as SignupStatus }));
}

async function loadPending(actor: Actor, id: string) {
  const [r] = await db()
    .select()
    .from(signupRequests)
    .where(and(eq(signupRequests.id, id), eq(signupRequests.organizationId, orgOf(actor))));
  if (!r) throw new AppError("not_found");
  if (r.status !== "pending") throw new AppError("conflict", { reason: "not_pending" });
  return r;
}

async function notifyDecision(r: typeof signupRequests.$inferSelect, event: "signup_approved" | "signup_rejected") {
  if (!providerFor("email")) return;
  const [org] = await db().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, r.organizationId));
  await enqueue("messages.send", {
    organizationId: r.organizationId,
    channel: "email",
    event,
    to: r.email,
    locale: r.locale,
    vars: {
      name: pickText(r.displayName, r.locale, r.email),
      company: pickText(org?.name, r.locale),
      link: appLink("/login", r.locale),
    },
  });
}

/** Approves a request: creates the account with the chosen role and branch, then tells the person by email. */
export async function approveSignup(actor: Actor, id: string, input: z.infer<typeof approveSignupInput>) {
  const org = orgOf(actor);
  requirePermission(actor, "users.invite", input.branchId);
  const request = await loadPending(actor, id);
  const role = await roleForInvite(actor, input.roleId);
  if (input.branchId) {
    const [b] = await db()
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.branchId), eq(branches.organizationId, org)));
    if (!b) throw new AppError("validation", { field: "branchId" });
  } else {
    requireOrgWide(actor, "users.invite");
  }

  const user = await db().transaction(async (tx) => {
    const claimed = await tx
      .update(signupRequests)
      .set({ status: "approved", decidedByUserId: actor.auth.user.id, decidedAt: new Date() })
      .where(and(eq(signupRequests.id, id), eq(signupRequests.status, "pending")))
      .returning({ id: signupRequests.id });
    if (!claimed.length) throw new AppError("conflict", { reason: "not_pending" });
    const [dup] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org), eq(users.email, request.email)));
    if (dup) throw new AppError("conflict", { field: "email" });
    const u = await provisionUser(tx, {
      organizationId: org,
      email: request.email,
      displayName: request.displayName,
      phone: request.phone,
      locale: request.locale,
      passwordHash: request.passwordHash,
      roleId: role.id,
      branchId: input.branchId,
    });
    await tx.update(signupRequests).set({ userId: u.id }).where(eq(signupRequests.id, id));
    await audit(
      {
        ...auditMeta(actor),
        branchId: input.branchId,
        action: "signup.approved",
        entityType: "signup_request",
        entityId: id,
        after: { userId: u.id, roleId: role.id },
      },
      tx,
    );
    return u;
  });
  await notifyDecision(request, "signup_approved");
  return { id, userId: user.id };
}

export async function rejectSignup(actor: Actor, id: string, input: z.infer<typeof rejectSignupInput>) {
  requirePermission(actor, "users.invite");
  const request = await loadPending(actor, id);
  const updated = await db()
    .update(signupRequests)
    .set({ status: "rejected", decidedByUserId: actor.auth.user.id, decidedAt: new Date(), rejectReason: input.reason ?? null })
    .where(and(eq(signupRequests.id, id), eq(signupRequests.status, "pending")))
    .returning({ id: signupRequests.id });
  if (!updated.length) throw new AppError("conflict", { reason: "not_pending" });
  await audit({
    ...auditMeta(actor),
    action: "signup.rejected",
    entityType: "signup_request",
    entityId: id,
    after: { reason: input.reason ?? null },
  });
  await notifyDecision(request, "signup_rejected");
  return { id };
}
