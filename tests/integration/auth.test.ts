import { generateTOTP } from "@oslojs/otp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches, cities, organizations, roles, rolePermissions, userRoles, users } from "@/db/schema";
import { syncPermissions } from "@/db/seed/permissions";
import { can } from "@/domain/rbac/permissions";
import { hashPassword } from "@/server/auth/password";
import { beginTotpSetup, changePassword, confirmTotpSetup, login, verifySecondFactor } from "@/server/auth/service";
import { invalidateUserSessions, validateSessionToken } from "@/server/auth/session";
import { decryptTotpSecret } from "@/server/auth/totp";
import { AppError } from "@/server/http/errors";
import { prepareTestDatabase, truncateAll } from "./helpers";

const available = await prepareTestDatabase();
const PASSWORD = "Strong-Pass-2026";
const client = { ip: "127.0.0.1", userAgent: "vitest" };

let orgId: string;
let branchId: string;
let userId: string;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("auth (database)", () => {
  beforeAll(async () => {
    await truncateAll();
  });

  beforeEach(async () => {
    await truncateAll();
    const [org] = await db()
      .insert(organizations)
      .values({ slug: "t", name: { ar: "اختبار", en: "Test" } })
      .returning();
    orgId = org.id;
    await syncPermissions(db(), orgId);
    const [city] = await db()
      .insert(cities)
      .values({ organizationId: orgId, code: "C1", name: { ar: "مدينة", en: "City" } })
      .returning();
    const [b] = await db()
      .insert(branches)
      .values({ organizationId: orgId, cityId: city.id, code: "B1", name: { ar: "فرع", en: "Branch" } })
      .returning();
    branchId = b.id;
    const [u] = await db()
      .insert(users)
      .values({
        organizationId: orgId,
        email: "agent@test.sa",
        displayName: { ar: "خالد" },
        passwordHash: await hashPassword(PASSWORD),
      })
      .returning();
    userId = u.id;
    const [agentRole] = await db().select().from(roles).where(eq(roles.key, "agent"));
    await db().insert(userRoles).values({ userId, roleId: agentRole.id, branchId });
  });

  afterAll(async () => {
    await pool().end();
  });

  it("logs in with correct credentials and loads branch-scoped grants", async () => {
    const res = await login({ email: " Agent@Test.sa ", password: PASSWORD }, client);
    expect(res.totpRequired).toBe(false);
    const auth = await validateSessionToken(res.token);
    expect(auth?.user.id).toBe(userId);
    expect(can(auth!.grants, "agent.serve", branchId)).toBe(true);
    expect(can(auth!.grants, "agent.serve", "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(can(auth!.grants, "settings.manage")).toBe(false);
  });

  it("rejects a wrong password and an unknown user with the same error", async () => {
    await expectCode(login({ email: "agent@test.sa", password: "nope" }, client), "invalid_credentials");
    await expectCode(login({ email: "ghost@test.sa", password: PASSWORD }, client), "invalid_credentials");
  });

  it("locks the account after repeated failures", async () => {
    for (let i = 0; i < 5; i++) await login({ email: "agent@test.sa", password: "wrong" }, client).catch(() => undefined);
    await expectCode(login({ email: "agent@test.sa", password: PASSWORD }, client), "account_locked");
  });

  it("refuses deactivated users and revoked sessions", async () => {
    const res = await login({ email: "agent@test.sa", password: PASSWORD }, client);
    await invalidateUserSessions(userId);
    expect(await validateSessionToken(res.token)).toBeNull();
    await db().update(users).set({ isActive: false }).where(eq(users.id, userId));
    await expectCode(login({ email: "agent@test.sa", password: PASSWORD }, client), "invalid_credentials");
  });

  it("enrols TOTP and then requires the second step", async () => {
    const first = await login({ email: "agent@test.sa", password: PASSWORD }, client);
    const auth = (await validateSessionToken(first.token))!;
    await beginTotpSetup(auth);
    const [u] = await db().select().from(users).where(eq(users.id, userId));
    const secret = decryptTotpSecret(u.totpSecretEnc!);
    const code = generateTOTP(secret, 30, 6);
    await expectCode(confirmTotpSetup(auth, code === "000000" ? "111111" : "000000", client), "invalid_code");
    await confirmTotpSetup(auth, code, client);

    const second = await login({ email: "agent@test.sa", password: PASSWORD }, client);
    expect(second.totpRequired).toBe(true);
    const pending = (await validateSessionToken(second.token))!;
    expect(pending.twoFactorVerified).toBe(false);
    await verifySecondFactor(pending, generateTOTP(secret, 30, 6), client);
    expect((await validateSessionToken(second.token))!.twoFactorVerified).toBe(true);
  });

  it("enforces the password policy and signs out other sessions on change", async () => {
    const a = await login({ email: "agent@test.sa", password: PASSWORD }, client);
    const auth = (await validateSessionToken(a.token))!;
    await expectCode(changePassword(auth, { currentPassword: PASSWORD, newPassword: "weak" }, client), "weak_password");
    await expectCode(
      changePassword(auth, { currentPassword: "bad", newPassword: "Another-Strong-99" }, client),
      "wrong_password",
    );
    const fresh = await changePassword(auth, { currentPassword: PASSWORD, newPassword: "Another-Strong-99" }, client);
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(fresh.token)).not.toBeNull();
  });

  it("keeps built-in roles in sync and never grants archived roles", async () => {
    const [adminRole] = await db().select().from(roles).where(eq(roles.key, "super_admin"));
    expect(adminRole.isSystem).toBe(true);
    const perms = await db().select().from(rolePermissions).where(eq(rolePermissions.roleId, adminRole.id));
    expect(perms.length).toBeGreaterThan(30);
    const [agentRole] = await db().select().from(roles).where(eq(roles.key, "agent"));
    await db().update(roles).set({ archivedAt: new Date() }).where(eq(roles.id, agentRole.id));
    const res = await login({ email: "agent@test.sa", password: PASSWORD }, client);
    expect((await validateSessionToken(res.token))!.grants).toEqual([]);
  });
});
