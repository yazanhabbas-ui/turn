import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, ts, updatedAt, type LocalizedText } from "./_common";
import { branches, cities, organizations } from "./tenancy";

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    displayName: jsonb("display_name").$type<LocalizedText>().notNull(),
    /** Normalized (Arabic-folded, lower-cased) name used for search. */
    nameSearch: text("name_search").notNull().default(""),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    passwordChangedAt: ts("password_changed_at"),
    locale: text("locale"),
    /** AES-256-GCM encrypted TOTP secret; null when 2FA is not enabled. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_org_email_uq").on(t.organizationId, t.email)],
);

/** Server-side sessions. `id` is the SHA-256 of the cookie token, so a DB leak cannot be replayed. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    /** False while a password-authenticated session is waiting for its TOTP step. */
    twoFactorVerified: boolean("two_factor_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Link between a user and an external OIDC identity (Microsoft Entra ID, Google, …). */
export const oidcAccounts = pgTable(
  "oidc_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oidc_provider_subject_uq").on(t.provider, t.subject)],
);

/** Catalogue of permission keys (seeded from code; see src/server/rbac/permissions.ts). */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  group: text("group").notNull(),
  description: jsonb("description").$type<LocalizedText>().notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>(),
    /** Built-in roles (admin, receptionist, agent, supervisor) cannot be deleted. */
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_org_key_uq").on(t.organizationId, t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/**
 * Role grant. `branch_id` limits it to one branch, `city_id` to every branch of one city (including branches added
 * later); with neither it applies to the whole organization. Never both.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    branchId: uuid("branch_id").references(() => branches.id),
    cityId: uuid("city_id").references(() => cities.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("user_roles_uq").on(t.userId, t.roleId, t.branchId, t.cityId).nullsNotDistinct(),
    index("user_roles_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** SHA-256 of the token in the invite link. */
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email"),
    phone: text("phone"),
    displayName: jsonb("display_name").$type<LocalizedText>(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    branchId: uuid("branch_id").references(() => branches.id),
    channel: text("channel").notNull().default("link"),
    locale: text("locale").notNull().default("ar"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    usedByUserId: uuid("used_by_user_id").references(() => users.id),
    revokedAt: ts("revoked_at"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("invites_org_idx").on(t.organizationId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** API keys for the REST API / integrations. Scoped by permission keys. */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  branchId: uuid("branch_id").references(() => branches.id),
  lastUsedAt: ts("last_used_at"),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
});
