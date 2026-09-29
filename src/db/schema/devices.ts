import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { archivedAt, createdAt, id, ts, updatedAt, type LocalizedText } from "./_common";
import { users } from "./identity";
import { branches, organizations } from "./tenancy";

/**
 * Display screen (a device, not a person). Paired with a short code, then authenticated by a long-lived
 * device token whose SHA-256 is stored here. Revoking sets `revoked_at`.
 */
export const displays = pgTable(
  "displays",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: text("name").notNull(),
    /** Device kind: display (waiting-room TV) or kiosk (self-service tablet). */
    kind: text("kind").notNull().default("display"),
    tokenHash: text("token_hash").unique(),
    pairingCode: text("pairing_code"),
    pairingExpiresAt: ts("pairing_expires_at"),
    pairedAt: ts("paired_at"),
    layout: text("layout").notNull().default("classic"),
    /** Layout, language rotation, zone filters, voice, ticker, theme overrides. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: ts("last_seen_at"),
    lastIp: text("last_ip"),
    userAgent: text("user_agent"),
    revokedAt: ts("revoked_at"),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("displays_pairing_code_uq").on(t.pairingCode), index("displays_branch_idx").on(t.branchId)],
);

/** Ticker text or slide shown on displays. */
export const announcements = pgTable("announcements", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  branchId: uuid("branch_id").references(() => branches.id),
  kind: text("kind").notNull().default("ticker"),
  body: jsonb("body").$type<LocalizedText>().notNull(),
  /** Image as a data URI or a URL on the local server (never a third-party CDN). */
  mediaUrl: text("media_url"),
  durationSeconds: integer("duration_seconds").notNull().default(10),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Editable template for any channel: `voice`, `sms`, `whatsapp`, `email`, `ticket_print`, `display`.
 * `body` holds per-locale text with placeholders such as {ticket} {desk} {agent} {reason} {position} {wait}.
 */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    channel: text("channel").notNull(),
    event: text("event").notNull(),
    subject: jsonb("subject").$type<LocalizedText>(),
    body: jsonb("body").$type<LocalizedText>().notNull(),
    /** Provider-side template name (WhatsApp Business requires pre-approved templates). */
    providerTemplate: text("provider_template"),
    isActive: boolean("is_active").notNull().default(true),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("message_templates_uq").on(t.organizationId, t.channel, t.event)],
);

export const notificationsLog = pgTable(
  "notifications_log",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    ticketId: uuid("ticket_id"),
    userId: uuid("user_id").references(() => users.id),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    event: text("event").notNull(),
    /** Masked recipient (PDPL: no full phone/email kept in logs). */
    recipientMasked: text("recipient_masked"),
    status: text("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("notifications_log_org_created_idx").on(t.organizationId, t.createdAt)],
);

/**
 * Pre-recorded voice pack (e.g. Arabic numbers + "desk" phrases) for kiosks without an Arabic TTS voice.
 * `manifest` maps clip keys (digits, letters, phrases) to file paths under /public/audio or uploaded storage.
 */
export const ttsAudioPacks = pgTable("tts_audio_packs", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  locale: text("locale").notNull(),
  name: text("name").notNull(),
  manifest: jsonb("manifest").$type<Record<string, string>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
