import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, ts, updatedAt, type LocalizedText } from "./_common";
import { users } from "./identity";
import { branches, desks, organizations } from "./tenancy";

export const agentStatus = pgEnum("agent_status", ["AVAILABLE", "BUSY", "ON_BREAK", "AWAY", "OFFLINE"]);
export type AgentStatus = (typeof agentStatus.enumValues)[number];

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
    /** Maximum tickets in CALLED/SERVING (and pre-assigned WAITING for push mode) at once. */
    /** Visitors this agent can have at once; null = the organization default (Settings → Agents). */
    maxConcurrent: integer("max_concurrent"),
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
