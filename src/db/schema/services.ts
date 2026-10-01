import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, updatedAt, type LocalizedText } from "./_common";
import { agentGroups } from "./agents";
import { users } from "./identity";
import { branches, cities, organizations } from "./tenancy";

/** Priority lanes / flags (VIP, Sheikh/guest, elderly, disabled, pregnant, urgent, ladies/family). Data, not an enum. */
export const priorityLevels = pgTable(
  "priority_levels",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    /** Score added by the ordering policy. 0 = normal. */
    weight: integer("weight").notNull().default(0),
    /** Separate lane: tickets are served from this lane before normal tickets of the same queue. */
    isLane: boolean("is_lane").notNull().default(false),
    color: text("color").notNull().default("#64748b"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("priority_levels_org_key_uq").on(t.organizationId, t.key)],
);

export type IntakeField = {
  key: string;
  /** Built-in keys: name, phone, company, national_id_last4, email, notes. Custom keys use `label`. */
  label?: LocalizedText;
  type?: "text" | "phone" | "number" | "email";
  required: boolean;
  /** May a visitor enter this at a self check-in kiosk? Unset = yes for name, phone, company, email, notes; no otherwise. */
  selfService?: boolean;
};

/** How a reason is delivered: one visitor at a desk (default), or a group together in a hall (D62). */
export const reasonDelivery = pgEnum("reason_delivery", ["desk", "hall"]);
export type ReasonDelivery = (typeof reasonDelivery.enumValues)[number];

/** Visit reason (service). Defines the ticket prefix and service expectations. */
export const visitReasons = pgTable(
  "visit_reasons",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>(),
    icon: text("icon").notNull().default("circle-help"),
    color: text("color").notNull().default("#0f766e"),
    /** Ticket prefix, Latin or Arabic letters (e.g. "A", "أ"). */
    prefix: text("prefix").notNull(),
    defaultPriorityKey: text("default_priority_key"),
    expectedServiceMinutes: integer("expected_service_minutes").notNull().default(10),
    slaTargetWaitMinutes: integer("sla_target_wait_minutes").notNull().default(15),
    intakeFields: jsonb("intake_fields").$type<IntakeField[]>().notNull().default([]),
    allowAppointments: boolean("allow_appointments").notNull().default(false),
    /** The visitor must be helped by staff: a self check-in kiosk shows this reason as "please ask the agent". */
    requiresStaff: boolean("requires_staff").notNull().default(false),
    /** desk = one visitor at a time at a desk; hall = served only by group sessions in a hall (never auto-assigned to desks). */
    delivery: reasonDelivery("delivery").notNull().default("desk"),
    /** Shown first on the reception screen for two-tap issuing. */
    isFeatured: boolean("is_featured").notNull().default(false),
    shortcutKey: text("shortcut_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("visit_reasons_org_code_uq").on(t.organizationId, t.code)],
);

/**
 * Per-city enablement of an organization reason. A city without a row for a reason has it enabled (the default), so
 * reasons added later appear everywhere; a row with `enabled = false` hides the reason in every branch of the city.
 */
export const cityReasons = pgTable(
  "city_reasons",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => visitReasons.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("city_reasons_city_reason_uq").on(t.cityId, t.reasonId)],
);

/** Who can serve a reason: an individual agent or a whole group, with proficiency and primary/backup flag. */
export const reasonAssignments = pgTable(
  "reason_assignments",
  {
    id: id(),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => visitReasons.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => agentGroups.id, { onDelete: "cascade" }),
    /** Null = applies in every branch. */
    branchId: uuid("branch_id").references(() => branches.id),
    proficiency: integer("proficiency").notNull().default(3),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("reason_assignments_reason_idx").on(t.reasonId), index("reason_assignments_user_idx").on(t.userId)],
);

/** A reason's queue in one branch. Holds the number range; tickets belong to a queue. */
export const queues = pgTable(
  "queues",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => visitReasons.id),
    /** Overrides the reason prefix in this branch when set. */
    prefix: text("prefix"),
    numberStart: integer("number_start").notNull().default(1),
    numberEnd: integer("number_end").notNull().default(999),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("queues_branch_reason_uq").on(t.branchId, t.reasonId)],
);

/**
 * Distribution configuration. Resolution order: queue → branch → global.
 * `config` is validated by the domain schema (src/domain/distribution/config.ts).
 */
export const distributionRules = pgTable(
  "distribution_rules",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    scope: text("scope").notNull(),
    branchId: uuid("branch_id").references(() => branches.id),
    queueId: uuid("queue_id").references(() => queues.id),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("distribution_rules_scope_uq").on(t.organizationId, t.scope, t.branchId, t.queueId).nullsNotDistinct()],
);

/** Daily ticket number counter per branch and prefix. Incremented under row lock. */
export const ticketCounters = pgTable(
  "ticket_counters",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    prefix: text("prefix").notNull(),
    serviceDay: date("service_day").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.prefix, t.serviceDay] })],
);
