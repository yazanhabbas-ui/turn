/**
 * Creates the organization and the first super admin on an installation WITHOUT demo data.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run admin:create
 *
 * Variables: ADMIN_EMAIL, ADMIN_PASSWORD (required), ADMIN_NAME_AR / ADMIN_NAME_EN (default: the e-mail),
 * ORG_NAME_AR / ORG_NAME_EN (default "Dor"), SEED_ORG_SLUG (default "demo", must match the seed's slug).
 * Idempotent: an existing account is left untouched (password included). `--reset-password` replaces the password
 * of an existing account (recovery when the only super admin is locked out). The docker entrypoint runs this
 * automatically when SEED_DEMO is not "true" and both ADMIN_* variables are set.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { DEFAULT_PASSWORD_POLICY, checkPassword } from "@/domain/auth/password-policy";
import { hashPassword } from "@/server/auth/password";
import { logger } from "@/server/logger";
import { db, pool } from "./client";
import * as s from "./schema";
import { syncPermissions } from "./seed/permissions";

export type BootstrapInput = {
  email: string;
  password: string;
  nameAr?: string;
  nameEn?: string;
  orgSlug?: string;
  orgNameAr?: string;
  orgNameEn?: string;
  resetPassword?: boolean;
};

export type BootstrapResult = { status: "created" | "exists" | "password_reset"; organizationId: string; userId: string };

export async function bootstrapAdmin(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("ADMIN_EMAIL is not a valid e-mail address");
  const issues = checkPassword(input.password, DEFAULT_PASSWORD_POLICY, { email });
  if (issues.length)
    throw new Error(`ADMIN_PASSWORD is too weak (${issues.join(", ")}); minimum length ${DEFAULT_PASSWORD_POLICY.minLength}`);
  const slug = input.orgSlug ?? "demo";
  const nameAr = input.nameAr?.trim() || email;
  const nameEn = input.nameEn?.trim() || email;

  return db().transaction(async (tx) => {
    let [org] = await tx.select().from(s.organizations).where(eq(s.organizations.slug, slug));
    if (!org) {
      [org] = await tx
        .insert(s.organizations)
        .values({
          slug,
          name: { ar: input.orgNameAr?.trim() || "دور", en: input.orgNameEn?.trim() || "Dor" },
          defaultLocale: "ar",
          locales: ["ar", "en"],
        })
        .returning();
    }
    await syncPermissions(tx, org.id);

    const [existing] = await tx
      .select()
      .from(s.users)
      .where(and(eq(s.users.organizationId, org.id), eq(s.users.email, email)));
    if (existing) {
      if (!input.resetPassword) return { status: "exists", organizationId: org.id, userId: existing.id };
      await tx
        .update(s.users)
        .set({
          passwordHash: await hashPassword(input.password),
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          isActive: true,
        })
        .where(eq(s.users.id, existing.id));
      return { status: "password_reset", organizationId: org.id, userId: existing.id };
    }

    const [user] = await tx
      .insert(s.users)
      .values({
        organizationId: org.id,
        email,
        displayName: { ar: nameAr, en: nameEn },
        nameSearch: `${normalizeArabic(nameAr)} ${normalizeArabic(nameEn)}`,
        passwordHash: await hashPassword(input.password),
        passwordChangedAt: new Date(),
        locale: "ar",
      })
      .returning();
    const [role] = await tx
      .select({ id: s.roles.id })
      .from(s.roles)
      .where(and(eq(s.roles.organizationId, org.id), eq(s.roles.key, "super_admin")));
    await tx.insert(s.userRoles).values({ userId: user.id, roleId: role.id, branchId: null, cityId: null });
    return { status: "created", organizationId: org.id, userId: user.id };
  });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/db/bootstrap-admin.ts")) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (see docs/deployment.md).");
    process.exit(2);
  }
  bootstrapAdmin({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    nameAr: process.env.ADMIN_NAME_AR,
    nameEn: process.env.ADMIN_NAME_EN,
    orgSlug: process.env.SEED_ORG_SLUG,
    orgNameAr: process.env.ORG_NAME_AR,
    orgNameEn: process.env.ORG_NAME_EN,
    resetPassword: process.argv.includes("--reset-password"),
  })
    .then((r) => logger.info({ status: r.status }, `first admin: ${r.status}`))
    .catch((err) => {
      // Do not print the stack: the message never contains the password.
      logger.fatal({ reason: err instanceof Error ? err.message : String(err) }, "admin bootstrap failed");
      process.exitCode = 1;
    })
    .finally(() => pool().end());
}
