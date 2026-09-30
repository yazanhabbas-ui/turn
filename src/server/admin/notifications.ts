import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, messageTemplates, notificationsLog } from "@/db/schema";
import { looksLikeEmail, renderMessage, TEMPLATE_VARIABLES } from "@/domain/notifications/policy";
import { maskRecipient } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { providerFor, providerStatus } from "../messaging/providers";
import { DEFAULT_TEMPLATES } from "../notifications/defaults";
import { dispatchNotifications } from "../notifications/dispatch";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "../settings/registry";
import { getSetting } from "../settings/service";
import { allowedBranches, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

/** Which channels can send right now. Nothing secret is ever returned: only configured / not configured / mock. */
export function providersOverview(actor: Actor) {
  requirePermission(actor, "admin.access");
  return { providers: providerStatus(), variables: [...TEMPLATE_VARIABLES] };
}

/** The event × channel template grid: what is stored, or the built-in wording where the organization has none yet. */
export async function notificationTemplates(actor: Actor) {
  requireOrgWide(actor, "templates.manage");
  const stored = await db()
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.organizationId, orgOf(actor)));
  return DEFAULT_TEMPLATES.map((d) => {
    const row = stored.find((r) => r.channel === d.channel && r.event === d.event);
    return {
      channel: d.channel,
      event: d.event,
      subject: (row ? row.subject : d.subject) ?? null,
      body: row ? row.body : d.body,
      providerTemplate: row?.providerTemplate ?? null,
      isActive: row ? row.isActive : true,
      isDefault: !row,
      defaults: { subject: d.subject ?? null, body: d.body },
    };
  });
}

export const logFilter = z.object({
  status: z.enum(["queued", "sending", "sent", "failed", "skipped"]).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  event: z.string().max(40).optional(),
  branchId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** The delivery log: masked recipients only. Branch-limited admins see their own branches. */
export async function listNotificationLog(actor: Actor, filter: z.infer<typeof logFilter>) {
  requirePermission(actor, "admin.access");
  const conds: SQL[] = [eq(notificationsLog.organizationId, orgOf(actor)), sql`${notificationsLog.ticketId} is not null`];
  const scope = allowedBranches(actor, "admin.access");
  if (scope !== "all") conds.push(scope.length ? inArray(notificationsLog.branchId, scope) : sql`false`);
  if (filter.branchId) conds.push(eq(notificationsLog.branchId, filter.branchId));
  if (filter.status) conds.push(eq(notificationsLog.status, filter.status));
  if (filter.channel) conds.push(eq(notificationsLog.channel, filter.channel));
  if (filter.event) conds.push(eq(notificationsLog.event, filter.event));
  if (filter.from) conds.push(gte(notificationsLog.createdAt, new Date(filter.from)));
  if (filter.to) conds.push(lte(notificationsLog.createdAt, new Date(filter.to)));
  if (filter.before) conds.push(lt(notificationsLog.createdAt, new Date(filter.before)));
  const rows = await db()
    .select({
      id: notificationsLog.id,
      branchId: notificationsLog.branchId,
      ticketId: notificationsLog.ticketId,
      channel: notificationsLog.channel,
      provider: notificationsLog.provider,
      event: notificationsLog.event,
      recipientMasked: notificationsLog.recipientMasked,
      status: notificationsLog.status,
      error: notificationsLog.error,
      attempts: notificationsLog.attempts,
      createdAt: notificationsLog.createdAt,
      sentAt: notificationsLog.sentAt,
      branchName: branches.name,
      ticketNumber: sql<string | null>`(select display_number from tickets where tickets.id = ${notificationsLog.ticketId})`,
    })
    .from(notificationsLog)
    .leftJoin(branches, eq(branches.id, notificationsLog.branchId))
    .where(and(...conds))
    .orderBy(desc(notificationsLog.createdAt))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  return {
    items: page.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      branchName: r.branchName ?? null,
    })),
    next: rows.length > filter.limit ? page[page.length - 1].createdAt.toISOString() : null,
  };
}

/** Puts a failed (or skipped for a temporary reason) notification back in the queue. */
export async function resendNotification(actor: Actor, id: string) {
  requirePermission(actor, "admin.access");
  const [row] = await db()
    .select()
    .from(notificationsLog)
    .where(and(eq(notificationsLog.id, id), eq(notificationsLog.organizationId, orgOf(actor))));
  if (!row || !row.ticketId) throw new AppError("not_found");
  requirePermission(actor, "admin.access", row.branchId);
  if (row.status !== "failed" && row.status !== "skipped") throw new AppError("conflict", { reason: "not_resendable" });
  const payload = row.payload as { channels?: string[] };
  if (!payload.channels?.length) throw new AppError("conflict", { reason: "not_resendable" });
  await db()
    .update(notificationsLog)
    .set({
      status: "queued",
      error: null,
      attempts: 0,
      nextAttemptAt: new Date(),
      payload: { ...payload, cursor: { index: 0, tries: 0 } },
    })
    .where(eq(notificationsLog.id, id));
  await audit({
    ...auditMeta(actor),
    branchId: row.branchId,
    action: "notification.resent",
    entityType: "notification",
    entityId: id,
  });
  dispatchNotifications([id]);
  return { ok: true };
}

export const testInput = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  to: z.string().trim().min(3).max(200),
  locale: z.enum(["ar", "en"]).default("ar"),
});

/** Sends a sample message to the administrator's own number or address, straight through the configured provider. */
export async function sendTestMessage(actor: Actor, input: z.infer<typeof testInput>) {
  requireOrgWide(actor, "settings.manage");
  if (input.channel === "email" ? !looksLikeEmail(input.to) : !/^\+?[\d\s()-]{6,20}$/.test(input.to))
    throw new AppError("validation", { field: "to" });
  const provider = providerFor(input.channel);
  const org = orgOf(actor);
  const settings = await getSetting(org, "notifications");
  const sample = DEFAULT_TEMPLATES.find((t) => t.channel === input.channel && t.event === "ticket_issued")!;
  const [stored] = await db()
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.organizationId, org),
        eq(messageTemplates.channel, input.channel),
        eq(messageTemplates.event, "ticket_issued"),
      ),
    );
  const body = stored?.body ?? sample.body;
  const vars = {
    number: "A-001",
    ticket: "A-001",
    name: pickText(actor.auth.user.displayName, input.locale),
    desk: "3",
    wait: "5",
    ahead: "2",
    branch: "—",
    reason: "—",
    link: "https://example.invalid/t/test",
    stopLink: "https://example.invalid/t/test/stop",
    feedbackLink: "",
  };
  const to = input.to.replace(/\s+/g, "");
  const base = {
    organizationId: org,
    userId: actor.auth.user.id,
    channel: input.channel,
    event: "test",
    recipientMasked: maskRecipient(to),
    payload: {},
  };
  if (!provider) {
    await db()
      .insert(notificationsLog)
      .values({ ...base, provider: "none", status: "skipped", error: "channel_not_configured" });
    throw new AppError("conflict", { reason: "channel_not_configured" });
  }
  const text = renderMessage(pickText(body, input.locale), vars);
  const footer = input.channel === "whatsapp" ? "" : `\n\n${renderMessage(pickText(settings.footer, input.locale), vars)}`;
  const result = await provider.send({
    channel: input.channel,
    to,
    subject: sample.subject ? renderMessage(pickText(stored?.subject ?? sample.subject, input.locale), vars) : undefined,
    text: text + footer,
    locale: input.locale,
    providerTemplate: input.channel === "whatsapp" ? stored?.providerTemplate : null,
    variables: vars,
    templateParams: [],
  });
  await db()
    .insert(notificationsLog)
    .values({
      ...base,
      provider: provider.id,
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.providerMessageId ?? null,
      error: result.ok ? null : (result.error ?? "send_failed").slice(0, 500),
      attempts: 1,
      sentAt: result.ok ? new Date() : null,
    });
  return { ok: result.ok, error: result.ok ? null : (result.error ?? "send_failed") };
}

export { NOTIFICATION_EVENTS };
