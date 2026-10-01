import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, desks, halls, messageTemplates, notificationsLog, tickets, visitReasons, visitors } from "@/db/schema";
import { looksLikeEmail, RateLimiter, renderMessage, retryDelaySeconds, type NotifyChannel } from "@/domain/notifications/policy";
import { maskRecipient, placeholdersOf } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { logger } from "../logger";
import { providerFor } from "../messaging/providers";
import { getSetting } from "../settings/service";
import { pickByCity } from "../settings/templates";
import { defaultTemplate, isLegacyDefault } from "./defaults";
import { registerFeedbackTemplateVars } from "../feedback/register";
import { buildTemplateVars } from "./vars";

registerFeedbackTemplateVars();

/** Asks the job runner to call `deliverNotification(logId)` again after `delaySeconds`. */
export type Schedule = (logId: string, delaySeconds: number) => Promise<void>;

const limiter = new RateLimiter();
const LEASE_SECONDS = 300;

type Cursor = { index: number; tries: number };
type Payload = { locale?: string; channels?: NotifyChannel[]; cursor?: Cursor; ahead?: string; wait?: string };

/**
 * The template for a channel and event: the branch's city own wording if it has one, else the organization's, else the
 * built-in wording.
 */
export async function templateFor(organizationId: string, channel: string, event: string, cityId: string | null = null) {
  const rows = await db()
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.organizationId, organizationId),
        eq(messageTemplates.channel, channel),
        eq(messageTemplates.event, event),
        cityId ? or(isNull(messageTemplates.cityId), eq(messageTemplates.cityId, cityId)) : isNull(messageTemplates.cityId),
      ),
    );
  const row = pickByCity(rows, cityId);
  // A stored copy of the old built-in wording follows the current built-in one (it gained the hall line).
  const d0 = row ? defaultTemplate(channel, event) : undefined;
  if (row && d0 && isLegacyDefault(channel, event, row.body)) {
    return row.isActive ? { subject: row.subject, body: d0.body, providerTemplate: row.providerTemplate } : null;
  }
  if (row) return row.isActive ? { subject: row.subject, body: row.body, providerTemplate: row.providerTemplate } : null;
  const d = defaultTemplate(channel, event);
  return d ? { subject: d.subject ?? null, body: d.body, providerTemplate: null } : null;
}

/**
 * Sends one queued notification (the worker calls this). Claims the row first, so two workers never send the same
 * message. Walks the ticket's channels in order: a channel that is not configured is skipped, one that fails for good
 * or keeps failing falls back to the next, and a temporary failure is retried later with exponential backoff.
 * Never throws.
 */
export async function deliverNotification(logId: string, schedule: Schedule): Promise<void> {
  try {
    await deliver(logId, schedule);
  } catch (err) {
    logger.error({ err, logId }, "visitor notification delivery crashed");
    await db()
      .update(notificationsLog)
      .set({ status: "failed", error: `internal: ${err instanceof Error ? err.message.slice(0, 200) : "error"}` })
      .where(and(eq(notificationsLog.id, logId), inArray(notificationsLog.status, ["sending", "queued"])))
      .catch(() => undefined);
  }
}

async function deliver(logId: string, schedule: Schedule) {
  const now = new Date();
  const [row] = await db()
    .update(notificationsLog)
    .set({ status: "sending", nextAttemptAt: new Date(now.getTime() + LEASE_SECONDS * 1000) })
    .where(
      and(
        eq(notificationsLog.id, logId),
        or(
          eq(notificationsLog.status, "queued"),
          and(eq(notificationsLog.status, "sending"), lte(notificationsLog.nextAttemptAt, now)),
        ),
      ),
    )
    .returning();
  if (!row || !row.ticketId) return;

  const finish = (patch: Partial<typeof notificationsLog.$inferInsert>) =>
    db()
      .update(notificationsLog)
      .set({ nextAttemptAt: null, ...patch })
      .where(eq(notificationsLog.id, logId));

  const [ctx] = await db()
    .select({ t: tickets, v: visitors })
    .from(tickets)
    .leftJoin(visitors, eq(visitors.id, tickets.visitorId))
    .where(eq(tickets.id, row.ticketId));
  if (!ctx) return void (await finish({ status: "skipped", error: "ticket_missing" }));
  const { t, v } = ctx;
  const settings = await getSetting(t.organizationId, "notifications", t.branchId);
  // Things can change between queuing and sending.
  if (v?.notificationsOptOut) return void (await finish({ status: "skipped", error: "opted_out" }));
  if (!settings.enabled || !settings.events[row.event as keyof typeof settings.events]?.enabled)
    return void (await finish({ status: "skipped", error: "disabled" }));

  const payload = row.payload as Payload;
  const chain = payload.channels ?? [];
  const locale = payload.locale ?? t.language;
  let { index, tries } = payload.cursor ?? { index: 0, tries: 0 };
  let attempts = row.attempts;
  let lastError: string | null = null;
  let lastChannel: string = row.channel;
  let lastProvider: string = row.provider;

  const [[branch], [reason], [desk], [hall]] = await Promise.all([
    db().select().from(branches).where(eq(branches.id, t.branchId)),
    db().select().from(visitReasons).where(eq(visitReasons.id, t.reasonId)),
    t.deskId ? db().select().from(desks).where(eq(desks.id, t.deskId)) : Promise.resolve([undefined]),
    t.hallId && row.event === "called" ? db().select().from(halls).where(eq(halls.id, t.hallId)) : Promise.resolve([undefined]),
  ]);
  const vars = await buildTemplateVars({
    event: row.event,
    locale,
    ticket: t,
    visitor: v ?? null,
    branch: branch ?? null,
    reason: reason ?? null,
    desk: desk ?? null,
    hall: hall ?? null,
    snapshot: { ahead: payload.ahead, wait: payload.wait },
  });

  while (index < chain.length) {
    const channel = chain[index];
    const provider = providerFor(channel);
    const tpl = await templateFor(t.organizationId, channel, row.event, branch?.cityId ?? null);
    const to = channel === "email" ? (looksLikeEmail(t.intake?.email) ? t.intake.email.trim() : null) : (v?.phone ?? null);
    if (!provider || !tpl || !to) {
      lastError = !provider ? "channel_not_configured" : !tpl ? "template_missing" : "no_recipient";
      index++;
      tries = 0;
      continue;
    }
    lastChannel = channel;
    lastProvider = provider.id;

    const perMinute = settings.limits.ratePerMinute[channel];
    if (!limiter.take(`${provider.id}`, perMinute)) {
      // Over the provider's limit: try again shortly, without counting it as a failed attempt.
      await finish({
        status: "queued",
        channel,
        provider: provider.id,
        payload: { ...payload, cursor: { index, tries } },
        nextAttemptAt: new Date(Date.now() + limiter.waitSeconds(provider.id) * 1000),
      });
      return schedule(logId, limiter.waitSeconds(provider.id));
    }

    const body = pickText(tpl.body, locale);
    let text = renderMessage(body, vars);
    if (channel !== "whatsapp") {
      const footer = renderMessage(pickText(settings.footer, locale), vars);
      if (footer && !text.includes(vars.stopLink)) text += `\n\n${footer}`;
    }
    const result = await provider.send({
      channel,
      to,
      subject: tpl.subject ? renderMessage(pickText(tpl.subject, locale), vars) : undefined,
      text,
      locale,
      providerTemplate: channel === "whatsapp" ? tpl.providerTemplate : null,
      variables: vars,
      templateParams: placeholdersOf(body).map((k) => vars[k] ?? ""),
    });
    attempts++;
    if (result.ok) {
      await finish({
        status: "sent",
        channel,
        provider: provider.id,
        recipientMasked: maskRecipient(to),
        providerMessageId: result.providerMessageId ?? null,
        error: null,
        attempts,
        sentAt: new Date(),
        payload: { ...payload, cursor: { index, tries: tries + 1 } },
      });
      return;
    }
    tries++;
    lastError = (result.error ?? "send_failed").slice(0, 500);
    if (result.retryable && tries < settings.limits.maxAttempts) {
      const delay = retryDelaySeconds(settings.limits.retryBaseSeconds, tries);
      await finish({
        status: "queued",
        channel,
        provider: provider.id,
        recipientMasked: maskRecipient(to),
        error: lastError,
        attempts,
        payload: { ...payload, cursor: { index, tries } },
        nextAttemptAt: new Date(Date.now() + delay * 1000),
      });
      return schedule(logId, delay);
    }
    // Not worth retrying, or out of attempts on this channel: fall back to the next one.
    index++;
    tries = 0;
  }

  await finish({
    status: attempts > 0 ? "failed" : "skipped",
    channel: lastChannel,
    provider: lastProvider,
    error: lastError ?? "no_channel",
    attempts,
    payload: { ...payload, cursor: { index, tries } },
  });
}

/** Puts back notifications whose job was lost (server stopped mid-send, queue unavailable) and returns their ids. */
export async function dueNotificationIds(limit = 50): Promise<string[]> {
  const cutoff = new Date(Date.now() - 20_000);
  const rows = await db()
    .select({ id: notificationsLog.id })
    .from(notificationsLog)
    .where(and(inArray(notificationsLog.status, ["queued", "sending"]), lte(notificationsLog.nextAttemptAt, cutoff)))
    .limit(limit);
  return rows.map((r) => r.id);
}
