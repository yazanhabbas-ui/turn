import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, ts, updatedAt, type LocalizedText } from "./_common";
import { users } from "./identity";
import { branches, cities, desks, halls, organizations } from "./tenancy";

export const agentStatus = pgEnum("agent_status", ["AVAILABLE", "BUSY", "ON_BREAK", "AWAY", "OFFLINE"]);
export type AgentStatus = (typeof agentStatus.enumValues)[number];

/**
 * A working shift of agents (for example morning and evening). Times are local to the agent's branch; a shift whose
 * end is not after its start runs past midnight. This is about when agents work, not about when the service is open.
 */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Null = an organization-wide shift every agent may use; set = a shift only that city's agents may use. */
    cityId: uuid("city_id").references(() => cities.id),
    code: text("code").notNull(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("shifts_org_code_uq").on(t.organizationId, t.code)],
);

/** Operational profile of a user who serves visitors. */
export const agentProfiles = pgTable(
  "agent_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    status: agentStatus("status").notNull().default("OFFLINE"),
    statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
    breakTypeId: uuid("break_type_id"),
    currentDeskId: uuid("current_desk_id").references(() => desks.id),
    defaultDeskId: uuid("default_desk_id").references(() => desks.id),
    /** The hall the agent is signed in to as host (an agent works at a desk or in a hall, never both). */
    currentHallId: uuid("current_hall_id").references(() => halls.id),
    /** The hall this agent usually hosts (profile assignment). */
    defaultHallId: uuid("default_hall_id").references(() => halls.id),
    /** Maximum tickets in CALLED/SERVING (and pre-assigned WAITING for push mode) at once. */
    /** Visitors this agent can have at once; null = the organization default (Settings → Agents). */
    maxConcurrent: integer("max_concurrent"),
    /** The agent's shift; null = no fixed shift. */
    shiftId: uuid("shift_id").references(() => shifts.id),
    /** Relative weight for the weighted auto-assign strategy. */
    weight: integer("weight").notNull().default(1),
    /** Last time the agent finished a ticket or became available; used by "longest idle". */
    lastIdleSince: ts("last_idle_since"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agent_profiles_branch_idx").on(t.branchId)],
);

/** Department / team. Reasons can be assigned to a group instead of individual agents. */
export const agentGroups = pgTable("agent_groups", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  branchId: uuid("branch_id").references(() => branches.id),
  name: jsonb("name").$type<LocalizedText>().notNull(),
  supervisorUserId: uuid("supervisor_user_id").references(() => users.id),
  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentGroupMembers = pgTable(
  "agent_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => agentGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const breakTypes = pgTable("break_types", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: jsonb("name").$type<LocalizedText>().notNull(),
  /** Expected maximum minutes; exceeding it can raise an alert. */
  maxMinutes: integer("max_minutes"),
  /** Paid/productive breaks (e.g. training) can be excluded from idle calculations. */
  countsAsProductive: boolean("counts_as_productive").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every agent status change as an interval-opening event; reports derive login/break/idle time from it. */
export const agentStatusLog = pgTable(
  "agent_status_log",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: agentStatus("status").notNull(),
    breakTypeId: uuid("break_type_id").references(() => breakTypes.id),
    deskId: uuid("desk_id").references(() => desks.id),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("agent_status_log_user_at_idx").on(t.userId, t.at), index("agent_status_log_branch_at_idx").on(t.branchId, t.at)],
);

/**
 * An agent's wish to start a break while the break limit is reached. They wait in order; when a place frees up the
 * first one is offered it (`offered`, valid until `offer_expires_at`) and is notified.
 */
export const breakRequests = pgTable(
  "break_requests",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Order of arrival; the line is served in this order. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    breakTypeId: uuid("break_type_id"),
    /** waiting → offered → taken, or cancelled / expired. */
    status: text("status").notNull().default("waiting"),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    offeredAt: ts("offered_at"),
    offerExpiresAt: ts("offer_expires_at"),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("break_requests_branch_status_idx").on(t.branchId, t.status), index("break_requests_user_idx").on(t.userId)],
);
