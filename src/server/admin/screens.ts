import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { announcements, branches, displays, messageTemplates, ttsAudioPacks } from "@/db/schema";
import { DISPLAY_LAYOUTS, displayConfigSchema, parseDisplayConfig } from "@/domain/display/config";
import { localizedText, uuid } from "@/domain/validation";
import { audit } from "../audit";
import { issuePairingCode } from "../display/device";
import { AppError } from "../http/errors";
import { io } from "../realtime";
import { auditMeta, orgOf, requirePermission, type Actor } from "./actor";

const ONLINE_WINDOW_MS = 60_000;

/** Tells every paired screen of the organization to refetch (ticker, slides, templates and voice changed). */
function refreshScreens(organizationId: string) {
  io()?.to(`displays:${organizationId}`).emit("display.refresh", {});
}

/** Local server paths and inline images/audio only: screens must never load third-party content. */
const localMedia = (prefix: "image" | "audio") =>
  z
    .string()
    .max(2_000_000)
    .refine((v) => v.startsWith("/") || v.startsWith(`data:${prefix}/`), { message: "local_media_only" });

/* ---------- Screens (display devices) ---------- */

export const displayInput = z.object({
  name: z.string().trim().min(1).max(80),
  branchId: uuid,
  layout: z.enum(DISPLAY_LAYOUTS),
  config: displayConfigSchema.prefault({}),
});

async function assertBranch(actor: Actor, branchId: string) {
  requirePermission(actor, "displays.manage", branchId);
  const [b] = await db()
    .select({ id: branches.id, organizationId: branches.organizationId, archivedAt: branches.archivedAt })
    .from(branches)
    .where(eq(branches.id, branchId));
  if (!b || b.organizationId !== orgOf(actor) || b.archivedAt) throw new AppError("validation", { field: "branchId" });
}

async function loadDisplay(actor: Actor, id: string) {
  const [d] = await db()
    .select()
    .from(displays)
    .where(and(eq(displays.id, id), eq(displays.organizationId, orgOf(actor)), isNull(displays.archivedAt)));
  if (!d) throw new AppError("not_found");
  requirePermission(actor, "displays.manage", d.branchId);
  return d;
}

function present(d: typeof displays.$inferSelect) {
  const now = Date.now();
  return {
    id: d.id,
    name: d.name,
    branchId: d.branchId,
    kind: d.kind,
    layout: d.layout,
    config: parseDisplayConfig(d.config),
    paired: !!d.tokenHash && !d.revokedAt,
    revoked: !!d.revokedAt,
    online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS && !d.revokedAt,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    pairedAt: d.pairedAt?.toISOString() ?? null,
    userAgent: d.userAgent,
    pairingCode: d.pairingCode && d.pairingExpiresAt && d.pairingExpiresAt.getTime() > now ? d.pairingCode : null,
    pairingExpiresAt: d.pairingExpiresAt?.toISOString() ?? null,
  };
}

export async function listDisplays(actor: Actor) {
  requirePermission(actor, "displays.manage");
  const rows = await db()
    .select()
    .from(displays)
    .where(and(eq(displays.organizationId, orgOf(actor)), isNull(displays.archivedAt)))
    .orderBy(asc(displays.createdAt));
  return rows.map(present);
}

export async function createDisplay(actor: Actor, input: z.infer<typeof displayInput>) {
  await assertBranch(actor, input.branchId);
  const [d] = await db()
    .insert(displays)
    .values({
      organizationId: orgOf(actor),
      branchId: input.branchId,
      name: input.name,
      layout: input.layout,
      config: input.config,
    })
    .returning();
  const pairing = await issuePairingCode(d.id);
  await audit({
    ...auditMeta(actor),
    branchId: d.branchId,
    action: "display.created",
    entityType: "display",
    entityId: d.id,
    after: input,
  });
  return { id: d.id, pairingCode: pairing.code, pairingExpiresAt: pairing.expiresAt.toISOString() };
}

export async function updateDisplay(actor: Actor, id: string, input: z.infer<typeof displayInput>) {
  const before = await loadDisplay(actor, id);
  await assertBranch(actor, input.branchId);
  await db()
    .update(displays)
    .set({ name: input.name, branchId: input.branchId, layout: input.layout, config: input.config, updatedAt: new Date() })
    .where(eq(displays.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: input.branchId,
    action: "display.updated",
    entityType: "display",
    entityId: id,
    before,
    after: input,
  });
  io()?.to(`display:${id}`).emit("display.refresh", {});
  return { id };
}

/** A new pairing code for a screen that lost its token (or a replacement TV). The old token stops working once used. */
export async function newPairingCode(actor: Actor, id: string) {
  const d = await loadDisplay(actor, id);
  const pairing = await issuePairingCode(d.id);
  await audit({ ...auditMeta(actor), branchId: d.branchId, action: "display.pairing_code", entityType: "display", entityId: id });
  return { pairingCode: pairing.code, pairingExpiresAt: pairing.expiresAt.toISOString() };
}

/** Kills the device token immediately and disconnects the screen. */
async function revoke(id: string) {
  await db().update(displays).set({ revokedAt: new Date(), tokenHash: null }).where(eq(displays.id, id));
  const hub = io();
  hub?.to(`display:${id}`).emit("display.revoked", { reason: "revoked" });
  hub?.in(`display:${id}`).disconnectSockets(true);
}

export async function revokeDisplay(actor: Actor, id: string) {
  const d = await loadDisplay(actor, id);
  await revoke(id);
  await audit({ ...auditMeta(actor), branchId: d.branchId, action: "display.revoked", entityType: "display", entityId: id });
}

export async function deleteDisplay(actor: Actor, id: string) {
  const d = await loadDisplay(actor, id);
  await revoke(id);
  await db()
    .update(displays)
    .set({ archivedAt: new Date(), pairingCode: null, pairingExpiresAt: null })
    .where(eq(displays.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: d.branchId,
    action: "display.deleted",
    entityType: "display",
    entityId: id,
    before: d,
  });
}

/* ---------- Announcements (ticker lines and slides) ---------- */

export const announcementInput = z
  .object({
    kind: z.enum(["ticker", "slide"]),
    body: localizedText({ max: 400 }),
    mediaUrl: localMedia("image").nullable().optional(),
    durationSeconds: z.number().int().min(3).max(120).default(10),
    branchId: uuid.nullable().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((a) => !a.startsAt || !a.endsAt || a.startsAt < a.endsAt, { message: "invalid_range" });

export async function listAnnouncements(actor: Actor) {
  requirePermission(actor, "announcements.manage");
  const rows = await db()
    .select()
    .from(announcements)
    .where(eq(announcements.organizationId, orgOf(actor)))
    .orderBy(asc(announcements.kind), asc(announcements.sortOrder), asc(announcements.createdAt));
  return rows.map((a) => ({
    ...a,
    startsAt: a.startsAt?.toISOString() ?? null,
    endsAt: a.endsAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));
}

export async function saveAnnouncement(actor: Actor, id: string | null, input: z.infer<typeof announcementInput>) {
  requirePermission(actor, "announcements.manage", input.branchId ?? undefined);
  if (input.branchId) await assertBranch(actor, input.branchId);
  const values = {
    kind: input.kind,
    body: input.body,
    mediaUrl: input.kind === "slide" ? (input.mediaUrl ?? null) : null,
    durationSeconds: input.durationSeconds,
    branchId: input.branchId ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
  let entityId = id;
  let before: unknown = null;
  if (id) {
    const [a] = await db()
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organizationId, orgOf(actor))));
    if (!a) throw new AppError("not_found");
    before = a;
    await db()
      .update(announcements)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(announcements.id, id));
  } else {
    const [a] = await db()
      .insert(announcements)
      .values({ ...values, organizationId: orgOf(actor) })
      .returning();
    entityId = a.id;
  }
  await audit({
    ...auditMeta(actor),
    action: id ? "announcement.updated" : "announcement.created",
    entityType: "announcement",
    entityId,
    before,
    after: { ...input, mediaUrl: input.mediaUrl ? "(media)" : null },
  });
  refreshScreens(orgOf(actor));
  return { id: entityId! };
}

export async function deleteAnnouncement(actor: Actor, id: string) {
  requirePermission(actor, "announcements.manage");
  const [a] = await db()
    .select()
    .from(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.organizationId, orgOf(actor))));
  if (!a) throw new AppError("not_found");
  await db().delete(announcements).where(eq(announcements.id, id));
  await audit({
    ...auditMeta(actor),
    action: "announcement.deleted",
    entityType: "announcement",
    entityId: id,
    before: { ...a, mediaUrl: null },
  });
  refreshScreens(orgOf(actor));
}

/* ---------- Message templates (voice phrases, tickets, messages) ---------- */

export const TEMPLATE_CHANNELS = ["voice", "display", "ticket_print", "sms", "whatsapp", "email"] as const;

export const templateInput = z.object({
  channel: z.enum(TEMPLATE_CHANNELS),
  event: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/),
  subject: localizedText({ max: 200, required: false }).nullable().optional(),
  body: localizedText({ max: 2000 }),
  isActive: z.boolean().default(true),
});

export async function listTemplates(actor: Actor) {
  requirePermission(actor, "templates.manage");
  const rows = await db()
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.organizationId, orgOf(actor)))
    .orderBy(asc(messageTemplates.channel), asc(messageTemplates.event));
  return rows.map((t) => ({
    id: t.id,
    channel: t.channel,
    event: t.event,
    subject: t.subject,
    body: t.body,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

/** Creates or replaces the template for a channel + event. */
export async function saveTemplate(actor: Actor, input: z.infer<typeof templateInput>) {
  requirePermission(actor, "templates.manage");
  const org = orgOf(actor);
  const [before] = await db()
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.organizationId, org),
        eq(messageTemplates.channel, input.channel),
        eq(messageTemplates.event, input.event),
      ),
    );
  const values = {
    subject: input.subject ?? null,
    body: input.body,
    isActive: input.isActive,
    updatedByUserId: actor.auth.user.id,
    updatedAt: new Date(),
  };
  let id: string;
  if (before) {
    await db().update(messageTemplates).set(values).where(eq(messageTemplates.id, before.id));
    id = before.id;
  } else {
    const [t] = await db()
      .insert(messageTemplates)
      .values({ ...values, organizationId: org, channel: input.channel, event: input.event })
      .returning();
    id = t.id;
  }
  await audit({
    ...auditMeta(actor),
    action: before ? "template.updated" : "template.created",
    entityType: "message_template",
    entityId: id,
    before,
    after: input,
  });
  refreshScreens(org);
  return { id };
}

/* ---------- Pre-recorded voice packs ---------- */

export const audioPackInput = z.object({
  locale: z.enum(["ar", "en"]),
  name: z.string().trim().min(1).max(80),
  /** Clip key → local file path or inline audio. Keys look like `ar.digit.7`, `ar.letter.A`, `ar.phrase.number`. */
  manifest: z.record(z.string().regex(/^[a-z]{2}\.(digit|letter|phrase)\.[A-Za-z0-9_]+$/), localMedia("audio")),
  isActive: z.boolean().default(true),
});

export async function listAudioPacks(actor: Actor) {
  requirePermission(actor, "templates.manage");
  const rows = await db()
    .select()
    .from(ttsAudioPacks)
    .where(eq(ttsAudioPacks.organizationId, orgOf(actor)))
    .orderBy(asc(ttsAudioPacks.createdAt));
  return rows.map((p) => ({
    id: p.id,
    locale: p.locale,
    name: p.name,
    isActive: p.isActive,
    clips: Object.keys(p.manifest).length,
    manifest: p.manifest,
  }));
}

export async function saveAudioPack(actor: Actor, id: string | null, input: z.infer<typeof audioPackInput>) {
  requirePermission(actor, "templates.manage");
  const org = orgOf(actor);
  let entityId = id;
  if (id) {
    const [p] = await db()
      .select({ id: ttsAudioPacks.id })
      .from(ttsAudioPacks)
      .where(and(eq(ttsAudioPacks.id, id), eq(ttsAudioPacks.organizationId, org)));
    if (!p) throw new AppError("not_found");
    await db()
      .update(ttsAudioPacks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(ttsAudioPacks.id, id));
  } else {
    const [p] = await db()
      .insert(ttsAudioPacks)
      .values({ ...input, organizationId: org })
      .returning();
    entityId = p.id;
  }
  await audit({
    ...auditMeta(actor),
    action: id ? "audio_pack.updated" : "audio_pack.created",
    entityType: "audio_pack",
    entityId,
    after: { ...input, manifest: `${Object.keys(input.manifest).length} clips` },
  });
  refreshScreens(org);
  return { id: entityId! };
}

export async function deleteAudioPack(actor: Actor, id: string) {
  requirePermission(actor, "templates.manage");
  const [p] = await db()
    .select()
    .from(ttsAudioPacks)
    .where(and(eq(ttsAudioPacks.id, id), eq(ttsAudioPacks.organizationId, orgOf(actor))));
  if (!p) throw new AppError("not_found");
  await db().delete(ttsAudioPacks).where(eq(ttsAudioPacks.id, id));
  await audit({
    ...auditMeta(actor),
    action: "audio_pack.deleted",
    entityType: "audio_pack",
    entityId: id,
    before: { locale: p.locale, name: p.name },
  });
  refreshScreens(orgOf(actor));
}
