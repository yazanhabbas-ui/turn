import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./_common";
import { users } from "./identity";
import { visitReasons } from "./services";
import { branches, halls, organizations } from "./tenancy";
import { tickets } from "./tickets";

/** Which hall-delivered reasons a hall accepts. A hall with no rows accepts every reason delivered in halls. */
export const hallReasons = pgTable(
  "hall_reasons",
  {
    hallId: uuid("hall_id")
      .notNull()
      .references(() => halls.id, { onDelete: "cascade" }),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => visitReasons.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("hall_reasons_uq").on(t.hallId, t.reasonId)],
);

/** OPEN = visitors called, not all in yet; IN_SESSION = the host has started; CLOSED = finished; CANCELLED = nobody came. */
export const hallSessionStatus = pgEnum("hall_session_status", ["OPEN", "IN_SESSION", "CLOSED", "CANCELLED"]);
export type HallSessionStatus = (typeof hallSessionStatus.enumValues)[number];

export const hallTicketStatus = pgEnum("hall_ticket_status", ["CALLED", "ENTERED", "NO_SHOW", "DONE", "RELEASED"]);
export type HallTicketStatus = (typeof hallTicketStatus.enumValues)[number];

/** One group session: the host receives the called visitors together. At most one live session per hall and per host. */
export const hallSessions = pgTable(
  "hall_sessions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    hallId: uuid("hall_id")
      .notNull()
      .references(() => halls.id),
    hostAgentId: uuid("host_agent_id")
      .notNull()
      .references(() => users.id),
    status: hallSessionStatus("status").notNull().default("OPEN"),
    /** The hall's capacity when the session was opened (reports stay true if the capacity changes later). */
    capacity: integer("capacity").notNull(),
    /** The reason of the group when the group mode is "same reason". */
    reasonId: uuid("reason_id").references(() => visitReasons.id),
    calledAt: ts("called_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    closedAt: ts("closed_at"),
    outcome: text("outcome"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("hall_sessions_live_hall_uq")
      .on(t.hallId)
      .where(sql`${t.status} in ('OPEN','IN_SESSION')`),
    uniqueIndex("hall_sessions_live_host_uq")
      .on(t.hostAgentId)
      .where(sql`${t.status} in ('OPEN','IN_SESSION')`),
    index("hall_sessions_branch_called_idx").on(t.branchId, t.calledAt),
  ],
);

/** A visitor's place in a session. The ticket keeps its original queue time, so a released visitor returns to their place. */
export const hallSessionTickets = pgTable(
  "hall_session_tickets",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => hallSessions.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    status: hallTicketStatus("status").notNull().default("CALLED"),
    calledAt: ts("called_at").notNull().defaultNow(),
    enteredAt: ts("entered_at"),
    finishedAt: ts("finished_at"),
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("hall_session_tickets_uq").on(t.sessionId, t.ticketId),
    index("hall_session_tickets_ticket_idx").on(t.ticketId),
  ],
);
