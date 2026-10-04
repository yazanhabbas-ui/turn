import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, messageTemplates, notificationsLog } from "@/db/schema";
import { maskRecipient, renderTemplate } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { logger } from "../logger";
import { pickByCity } from "../settings/templates";
import { providerFor } from "./providers";
import { SYSTEM_EMAIL_TEMPLATES } from "./system-templates";
import type { Channel, MessageAttachment } from "./types";

export type SendRequest = {
  organizationId: string;
  branchId?: string | null;
  ticketId?: string | null;
  userId?: string | null;
  channel: Channel;
  event: string;
  to: string;
  locale: string;
  vars: Record<string, string>;
  /** Files to attach (email). Not serialisable, so requests carrying them are sent directly, not through the job queue. */
  attachments?: MessageAttachment[];
};

/**
 * Renders the organization's template for (channel, event) in the recipient's language, sends it through the
 * configured provider, and records a masked entry in notifications_log. Never throws for delivery failures.
 */
export async function sendTemplated(req: SendRequest): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const cityId = req.branchId
    ? ((await db().select({ cityId: branches.cityId }).from(branches).where(eq(branches.id, req.branchId)))[0]?.cityId ?? null)
    : null;
  // The city's own template wins over the organization's; an inactive city template falls back to the organization's.
  const tpls = await db()
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.organizationId, req.organizationId),
        eq(messageTemplates.channel, req.channel),
        eq(messageTemplates.event, req.event),
        eq(messageTemplates.isActive, true),
        cityId ? or(isNull(messageTemplates.cityId), eq(messageTemplates.cityId, cityId)) : isNull(messageTemplates.cityId),
      ),
    );
  const builtIn = req.channel === "email" ? SYSTEM_EMAIL_TEMPLATES[req.event] : undefined;
  const tpl =
    pickByCity(tpls, cityId) ?? (builtIn ? { subject: builtIn.subject, body: builtIn.body, providerTemplate: null } : undefined);
  const provider = providerFor(req.channel);
  const base = {
    organizationId: req.organizationId,
    branchId: req.branchId ?? null,
    ticketId: req.ticketId ?? null,
    userId: req.userId ?? null,
    channel: req.channel,
    provider: provider?.id ?? "none",
    event: req.event,
    recipientMasked: maskRecipient(req.to),
  };

  if (!tpl || !provider) {
    const error = !tpl ? "template_missing" : "channel_not_configured";
    await db()
      .insert(notificationsLog)
      .values({ ...base, status: "skipped", error });
    return { status: "skipped", error };
  }

  try {
    const result = await provider.send({
      channel: req.channel,
      to: req.to,
      subject: tpl.subject ? renderTemplate(pickText(tpl.subject, req.locale), req.vars) : undefined,
      text: renderTemplate(pickText(tpl.body, req.locale), req.vars),
      locale: req.locale,
      providerTemplate: tpl.providerTemplate,
      variables: req.vars,
      attachments: req.attachments,
    });
    if (!result.ok) {
      const error = (result.error ?? "send_failed").slice(0, 500);
      await db()
        .insert(notificationsLog)
        .values({ ...base, status: "failed", error });
      return { status: "failed", error };
    }
    await db()
      .insert(notificationsLog)
      .values({ ...base, status: "sent", providerMessageId: result.providerMessageId ?? null, sentAt: new Date() });
    return { status: "sent" };
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 500) : "send_failed";
    logger.warn({ err, channel: req.channel, event: req.event }, "message delivery failed");
    await db()
      .insert(notificationsLog)
      .values({ ...base, status: "failed", error });
    return { status: "failed", error };
  }
}
