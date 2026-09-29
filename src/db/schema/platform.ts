import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./_common";
import { users } from "./identity";
import { branches, organizations } from "./tenancy";

/**
 * Key/value settings. `branch_id` null = organization-wide; a branch row overrides the organization value.
 * Keys and value shapes are declared in src/server/settings/registry.ts.
 */
export const settings = pgTable(
  "settings",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("settings_scope_key_uq").on(t.organizationId, t.branchId, t.key).nullsNotDistinct()],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    actorType: text("actor_type").notNull().default("user"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_at_idx").on(t.organizationId, t.at), index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

/** In-app anomaly alerts (long wait, queue over limit, idle agent, no-show spike, hybrid release). */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("warning"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Deduplication key so the same condition does not raise repeated alerts. */
    dedupeKey: text("dedupe_key"),
    acknowledgedAt: ts("acknowledged_at"),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("alerts_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const reportSchedules = pgTable("report_schedules", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  branchId: uuid("branch_id").references(() => branches.id),
  name: text("name").notNull(),
  /** `daily` or `weekly`. */
  frequency: text("frequency").notNull(),
  /** Weekly schedules: the weekday to send on (0 = Sunday), in the branch (or organization) time zone. */
  weekday: integer("weekday"),
  /** Hour of day (0-23) to send at, in the branch (or organization) time zone. */
  sendHour: integer("send_hour").notNull().default(7),
  format: text("format").notNull().default("pdf"),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  locale: text("locale").notNull().default("ar"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: ts("last_run_at"),
  /** Why the last run failed; null after a successful run. */
  lastError: text("last_error"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Outbound webhooks for CRM / integrations (extension point). */
export const webhooks = pgTable("webhooks", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secret: text("secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Stored responses for idempotent POSTs (Idempotency-Key header). Purged after 24h. */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id"),
  requestHash: text("request_hash").notNull(),
  statusCode: text("status_code").notNull(),
  response: jsonb("response"),
  createdAt: createdAt(),
});
