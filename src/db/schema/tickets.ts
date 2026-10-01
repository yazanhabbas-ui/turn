import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./_common";
import { users } from "./identity";
import { queues, visitReasons } from "./services";
import { branches, desks, halls, organizations } from "./tenancy";

export const ticketStatus = pgEnum("ticket_status", [
  "APPOINTMENT_PENDING",
  "WAITING",
  "CALLED",
  "SERVING",
  "ON_HOLD",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
]);
export type TicketStatus = (typeof ticketStatus.enumValues)[number];

/**
 * Minimal visitor record (PDPL: collect the minimum). Personal fields are cleared by the retention job
 * after the configured number of days; `anonymized_at` records when.
 */
export const visitors = pgTable(
  "visitors",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name"),
    /** Arabic-folded name for search. */
    nameSearch: text("name_search"),
    /** Loose Latin transliteration for cross-script search. */
    nameTranslit: text("name_translit"),
    phone: text("phone"),
    /** Keyed hash of the normalized phone; enables sticky routing / returning detection without exposing the number. */
    phoneHash: text("phone_hash"),
    company: text("company"),
    preferredLanguage: text("preferred_language"),
    /** The visitor asked to stop receiving messages (STOP link); honoured on every channel and every visit. */
    notificationsOptOut: boolean("notifications_opt_out").notNull().default(false),
    notificationsOptOutAt: ts("notifications_opt_out_at"),
    visitCount: integer("visit_count").notNull().default(0),
    lastVisitAt: ts("last_visit_at"),
    lastAgentId: uuid("last_agent_id").references(() => users.id),
    anonymizedAt: ts("anonymized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("visitors_org_phone_hash_idx").on(t.organizationId, t.phoneHash)],
);

export const appointments = pgTable(
  "appointments",
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
    visitorId: uuid("visitor_id").references(() => visitors.id),
    /** Short code the visitor gives at reception. */
    code: text("code").notNull(),
    scheduledAt: ts("scheduled_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(15),
    preferredAgentId: uuid("preferred_agent_id").references(() => users.id),
    status: text("status").notNull().default("BOOKED"),
    notes: text("notes"),
    ticketId: uuid("ticket_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("appointments_branch_code_uq").on(t.branchId, t.code),
    index("appointments_branch_time_idx").on(t.branchId, t.scheduledAt),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.id),
    reasonId: uuid("reason_id")
      .notNull()
      .references(() => visitReasons.id),
    visitorId: uuid("visitor_id").references(() => visitors.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    prefix: text("prefix").notNull(),
    number: integer("number").notNull(),
    /** Formatted ticket number, e.g. "A-014". */
    displayNumber: text("display_number").notNull(),
    /** Branch-local business day the ticket belongs to (numbers reset per service day). */
    serviceDay: date("service_day").notNull(),
    status: ticketStatus("status").notNull(),
    priorityKey: text("priority_key"),
    language: text("language").notNull().default("ar"),
    /** Unguessable token for the visitor's public status page. */
    publicToken: text("public_token").notNull().unique(),
    /** Agent the ticket is reserved for (push / hybrid / manual / sticky). */
    assignedAgentId: uuid("assigned_agent_id").references(() => users.id),
    assignedAt: ts("assigned_at"),
    servingAgentId: uuid("serving_agent_id").references(() => users.id),
    deskId: uuid("desk_id").references(() => desks.id),
    /** Hall and group session the ticket is in (D62); the hall is cleared when the ticket goes back to the queue. */
    hallId: uuid("hall_id").references(() => halls.id),
    hallSessionId: uuid("hall_session_id"),
    /** Original arrival; preserved across transfers so waiting time is honest. */
    arrivedAt: ts("arrived_at").notNull().defaultNow(),
    /** When the ticket entered its current queue. */
    queuedAt: ts("queued_at").notNull().defaultNow(),
    calledAt: ts("called_at"),
    recallCount: integer("recall_count").notNull().default(0),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    outcome: text("outcome"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    /** Captured intake field values (PII; cleared by retention). */
    intake: jsonb("intake").$type<Record<string, string>>().notNull().default({}),
    consentAt: ts("consent_at"),
    source: text("source").notNull().default("reception"),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    /** Optimistic-concurrency version, incremented on every transition. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tickets_branch_day_number_uq").on(t.branchId, t.serviceDay, t.prefix, t.number),
    uniqueIndex("tickets_idempotency_uq").on(t.organizationId, t.idempotencyKey),
    index("tickets_queue_status_idx").on(t.queueId, t.status),
    index("tickets_branch_day_status_idx").on(t.branchId, t.serviceDay, t.status),
    index("tickets_assigned_idx").on(t.assignedAgentId, t.status),
    index("tickets_serving_idx").on(t.servingAgentId, t.status),
  ],
);

/**
 * Append-only event log for every ticket transition. Reports are computed from this table.
 * `type` examples: ISSUED, ASSIGNED, CALLED, RECALLED, STARTED, COMPLETED, NO_SHOW, TRANSFERRED, HELD, RESUMED,
 * CANCELLED, EDITED, RELEASED, REQUEUED, UNDONE.
 */
export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    type: text("type").notNull(),
    fromStatus: ticketStatus("from_status"),
    toStatus: ticketStatus("to_status"),
    actorType: text("actor_type").notNull().default("user"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    agentId: uuid("agent_id").references(() => users.id),
    deskId: uuid("desk_id").references(() => desks.id),
    queueId: uuid("queue_id").references(() => queues.id),
    fromQueueId: uuid("from_queue_id").references(() => queues.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [
    index("ticket_events_ticket_idx").on(t.ticketId, t.at),
    index("ticket_events_branch_at_idx").on(t.branchId, t.at),
    index("ticket_events_agent_at_idx").on(t.agentId, t.at),
  ],
);

export const csatResponses = pgTable(
  "csat_responses",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id)
      .unique(),
    agentId: uuid("agent_id").references(() => users.id),
    reasonId: uuid("reason_id").references(() => visitReasons.id),
    score: integer("score").notNull(),
    nps: integer("nps"),
    comment: text("comment"),
    /** Language of the page the visitor answered in (`ar` or `en`). */
    language: text("language"),
    /** `status_page`, `kiosk` or `link`. */
    channel: text("channel").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("csat_branch_at_idx").on(t.branchId, t.at)],
);
