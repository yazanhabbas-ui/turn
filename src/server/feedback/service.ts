import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { csatResponses, tickets } from "@/db/schema";
import { cleanComment, COMMENT_MAX } from "@/domain/feedback/csat";
import { now as clockNow } from "../clock";
import { AppError } from "../http/errors";
import { logger } from "../logger";
import { publish } from "../queue/publish";
import { raiseAlerts } from "../reports/alerts";
import { getSetting } from "../settings/service";

export const FEEDBACK_CHANNELS = ["status_page", "kiosk", "link"] as const;
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number];

export const feedbackInput = z.object({
  score: z.number().int().min(1).max(5),
  nps: z.number().int().min(0).max(10).nullish(),
  comment: z.string().max(COMMENT_MAX).nullish(),
  channel: z.enum(FEEDBACK_CHANNELS).optional(),
  language: z.enum(["ar", "en"]).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInput>;

/** What the visitor's page needs to draw the card. Only sent for a completed visit. */
export type FeedbackCard = {
  style: "stars" | "faces";
  askComment: boolean;
  askNps: boolean;
  prompt: Record<string, string>;
  commentPrompt: Record<string, string>;
  npsPrompt: Record<string, string>;
  thanks: Record<string, string>;
  commentMax: number;
  /** The visit was already rated (the card shows the thank-you). */
  answered: boolean;
};

type TicketRow = typeof tickets.$inferSelect;

/** The feedback card for a ticket, or null when feedback is off or the visit is not completed. */
export async function feedbackCardFor(t: TicketRow): Promise<FeedbackCard | null> {
  if (t.status !== "COMPLETED") return null;
  const cfg = await getSetting(t.organizationId, "feedback", t.branchId);
  if (!cfg.enabled) return null;
  const [done] = await db().select({ id: csatResponses.id }).from(csatResponses).where(eq(csatResponses.ticketId, t.id));
  return {
    style: cfg.style,
    askComment: cfg.askComment,
    askNps: cfg.askNps,
    prompt: cfg.prompt,
    commentPrompt: cfg.commentPrompt,
    npsPrompt: cfg.npsPrompt,
    thanks: cfg.thanks,
    commentMax: COMMENT_MAX,
    answered: !!done,
  };
}

/**
 * Records a visitor's answer. The ticket is found by its public token; it must belong to a completed visit and can
 * be answered once. Comment and recommend answers are kept only when the settings ask for them.
 */
export async function submitFeedback(token: string, raw: unknown, channel: FeedbackChannel = "status_page") {
  const input = feedbackInput.parse(raw);
  const [t] = token ? await db().select().from(tickets).where(eq(tickets.publicToken, token)) : [];
  if (!t) throw new AppError("not_found");
  const cfg = await getSetting(t.organizationId, "feedback", t.branchId);
  if (!cfg.enabled) throw new AppError("not_found");
  if (t.status !== "COMPLETED") throw new AppError("invalid_transition", { reason: "not_completed" });
  const [existing] = await db().select({ id: csatResponses.id }).from(csatResponses).where(eq(csatResponses.ticketId, t.id));
  if (existing) throw new AppError("conflict", { reason: "already_answered" });

  const at = new Date(clockNow());
  const rows = await db()
    .insert(csatResponses)
    .values({
      organizationId: t.organizationId,
      branchId: t.branchId,
      ticketId: t.id,
      agentId: t.servingAgentId,
      reasonId: t.reasonId,
      score: input.score,
      nps: cfg.askNps ? (input.nps ?? null) : null,
      comment: cfg.askComment ? cleanComment(input.comment) : null,
      channel: input.channel ?? channel,
      language: input.language ?? t.language,
      at,
    })
    .onConflictDoNothing({ target: csatResponses.ticketId })
    .returning({ id: csatResponses.id });
  // Two answers arriving at once: the second finds the row already there.
  if (!rows.length) throw new AppError("conflict", { reason: "already_answered" });

  publish([{ type: "queue.updated", branchId: t.branchId, cause: "feedback" }]);
  if (input.score <= cfg.lowScoreThreshold) {
    try {
      await raiseAlerts(t.branchId, at.getTime());
    } catch (err) {
      logger.warn({ err }, "low-score alert not raised");
    }
  }
  return { ok: true as const };
}
