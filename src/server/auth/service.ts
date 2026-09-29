import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema";
import { checkPassword } from "@/domain/auth/password-policy";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { getSetting } from "../settings/service";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";
import { createSession, invalidateUserSessions, markSessionTwoFactorVerified, type AuthContext } from "./session";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, totpUri, verifyTotp } from "./totp";

type ClientInfo = { ip?: string | null; userAgent?: string | null };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function login(
  input: { email: string; password: string; organization?: string },
  client: ClientInfo,
): Promise<{ token: string; expiresAt: Date; totpRequired: boolean }> {
  const email = normalizeEmail(input.email);
  const candidates = await db()
    .select({ user: users, orgSlug: organizations.slug })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(users.email, email), isNull(users.archivedAt)));

  const matches = input.organization ? candidates.filter((c) => c.orgSlug === input.organization) : candidates;
  if (matches.length > 1) throw new AppError("organization_required");
  const user = matches[0]?.user;

  if (!user || !user.passwordHash || !user.isActive) {
    await verifyPassword(await dummyPasswordHash(), input.password);
    throw new AppError("invalid_credentials");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("account_locked", { minutes: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000) });
  }

  const security = await getSetting(user.organizationId, "security");
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= security.maxFailedLogins;
    await db()
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + security.lockoutMinutes * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await audit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: lock ? "auth.locked" : "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      ...client,
    });
    throw new AppError("invalid_credentials");
  }

  const totpRequired = !!user.totpEnabledAt;
  const session = await createSession(user.id, { twoFactorVerified: !totpRequired, ...client });
  await db()
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: totpRequired ? user.lastLoginAt : new Date() })
    .where(eq(users.id, user.id));
  if (!totpRequired) {
    await audit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      ...client,
    });
  }
  return { ...session, totpRequired };
}

async function loadTotpSecret(userId: string): Promise<Uint8Array | null> {
  const [u] = await db().select({ enc: users.totpSecretEnc }).from(users).where(eq(users.id, userId));
  return u?.enc ? decryptTotpSecret(u.enc) : null;
}

export async function verifySecondFactor(auth: AuthContext, code: string, client: ClientInfo): Promise<void> {
  if (auth.twoFactorVerified) return;
  const secret = await loadTotpSecret(auth.user.id);
  if (!secret || !verifyTotp(secret, code)) {
    await audit({
      organizationId: auth.user.organizationId,
      actorUserId: auth.user.id,
      action: "auth.totp_failed",
      entityType: "user",
      entityId: auth.user.id,
      ...client,
    });
    throw new AppError("invalid_code");
  }
  await markSessionTwoFactorVerified(auth.sessionId);
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, auth.user.id));
  await audit({
    organizationId: auth.user.organizationId,
    actorUserId: auth.user.id,
    action: "auth.login",
    entityType: "user",
    entityId: auth.user.id,
    ...client,
  });
}

/** Validates a new password against the organization policy; throws `weak_password` with the failed rules. */
export async function assertPasswordAcceptable(organizationId: string, password: string, email?: string) {
  const { passwordPolicy } = await getSetting(organizationId, "security");
  const issues = checkPassword(password, passwordPolicy, { email });
  if (issues.length) throw new AppError("weak_password", { issues, minLength: passwordPolicy.minLength });
}

export async function changePassword(
  auth: AuthContext,
  input: { currentPassword: string; newPassword: string },
  client: ClientInfo,
): Promise<{ token: string; expiresAt: Date }> {
  const [u] = await db().select().from(users).where(eq(users.id, auth.user.id));
  if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, input.currentPassword))) {
    throw new AppError("wrong_password");
  }
  await assertPasswordAcceptable(u.organizationId, input.newPassword, u.email);
  const passwordHash = await hashPassword(input.newPassword);
  return db().transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, u.id));
    await invalidateUserSessions(u.id, tx);
    await audit(
      {
        organizationId: u.organizationId,
        actorUserId: u.id,
        action: "user.password_changed",
        entityType: "user",
        entityId: u.id,
        ...client,
      },
      tx,
    );
    // Keep the current device signed in with a fresh session.
    return createSession(u.id, { twoFactorVerified: true, ...client }, tx);
  });
}

/** Starts TOTP enrolment: stores a new pending secret (not yet enabled) and returns the otpauth:// URI. */
export async function beginTotpSetup(auth: AuthContext): Promise<{ uri: string; secretBase32: string }> {
  if (auth.user.totpEnabled) throw new AppError("conflict", { reason: "already_enabled" });
  const secret = generateTotpSecret();
  await db()
    .update(users)
    .set({ totpSecretEnc: encryptTotpSecret(secret) })
    .where(eq(users.id, auth.user.id));
  const [org] = await db()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, auth.user.organizationId));
  const issuer = org?.name.en || org?.name.ar || "Dor";
  return { uri: totpUri(issuer, auth.user.email, secret), secretBase32: encodeBase32UpperCaseNoPadding(secret) };
}

export async function confirmTotpSetup(auth: AuthContext, code: string, client: ClientInfo): Promise<void> {
  const secret = await loadTotpSecret(auth.user.id);
  if (!secret || !verifyTotp(secret, code)) throw new AppError("invalid_code");
  await db()
    .update(users)
    .set({ totpEnabledAt: sql`now()` })
    .where(eq(users.id, auth.user.id));
  await audit({
    organizationId: auth.user.organizationId,
    actorUserId: auth.user.id,
    action: "user.totp_enabled",
    entityType: "user",
    entityId: auth.user.id,
    ...client,
  });
}

export async function disableTotp(auth: AuthContext, password: string, client: ClientInfo): Promise<void> {
  const [u] = await db().select().from(users).where(eq(users.id, auth.user.id));
  if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw new AppError("wrong_password");
  await db().update(users).set({ totpSecretEnc: null, totpEnabledAt: null }).where(eq(users.id, u.id));
  await audit({
    organizationId: u.organizationId,
    actorUserId: u.id,
    action: "user.totp_disabled",
    entityType: "user",
    entityId: u.id,
    ...client,
  });
}
