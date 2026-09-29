import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { messageTemplates, notificationsLog } from "@/db/schema";
import { maskRecipient, renderTemplate } from "@/domain/templates/render";
import { pickText } from "@/i18n/locales";
import { logger } from "../logger";
import { providerFor } from "./providers";
import type { Channel } from "./types";

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
};

/**
 * Renders the organization's template for (channel, event) in the recipient's language, sends it through the
 * configured provider, and records a masked entry in notifications_log. Never throws for delivery failures.
 */
export async function sendTemplated(req: SendRequest): Promise<{ status: "sent" | "failed" | "skipped"; error?: string }> {
  const [tpl] = await db()
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.organizationId, req.organizationId),
        eq(messageTemplates.channel, req.channel),
        eq(messageTemplates.event, req.event),
        eq(messageTemplates.isActive, true),
      ),
    );
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
    });
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
