import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { agentProfiles } from "@/db/schema";
import { can } from "@/domain/rbac/permissions";
import { uuid } from "@/domain/validation";
import { LOCALE_CODES } from "@/i18n/locales";
import type { Actor } from "../admin/actor";
import { AppError } from "../http/errors";
import { getSetting } from "../settings/service";
import { agentIssuingState } from "./reception-status";
import { issueInput, issueTicketWith, type IssuedTicket } from "./tickets";

export const agentIssueInput = z.object({
  reasonId: uuid,
  priorityKey: z.string().max(40).nullable().optional(),
  language: z.enum(LOCALE_CODES as [string, ...string[]]).default("ar"),
  fields: issueInput.shape.fields,
  consent: z.boolean().default(false),
  /** true = the issuing agent takes the visitor now; false = the ticket joins the queue like any other. */
  serveNow: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type AgentIssueInput = z.infer<typeof agentIssueInput>;

/**
 * An agent issues a walk-in ticket in their own branch (D61). Needs `tickets.issue_self` and the branch setting
 * `reception.agentIssuing` to allow it; everything else (reason, intake fields, consent, numbering, wait estimate) is
 * the same service reception uses.
 */
export async function agentIssue(actor: Actor, input: AgentIssueInput): Promise<IssuedTicket> {
  const me = actor.auth.user;
  const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, me.id));
  if (!profile || !can(actor.auth.grants, "tickets.issue_self", profile.branchId)) throw new AppError("forbidden");
  const state = await agentIssuingState(me.organizationId, profile.branchId);
  if (!state.allowed) throw new AppError("forbidden", { reason: "agent_issuing_off" });

  let serve: { agentId: string; deskId: string } | undefined;
  if (input.serveNow) {
    if (!can(actor.auth.grants, "agent.serve", profile.branchId)) throw new AppError("forbidden");
    const deskId = profile.currentDeskId ?? profile.defaultDeskId;
    if (!deskId) throw new AppError("validation", { reason: "desk_required" });
    serve = { agentId: me.id, deskId };
  }
  // The priority chips follow the reception setting: when it does not offer a choice, the reason's default applies.
  const reception = await getSetting(me.organizationId, "reception", profile.branchId);
  return issueTicketWith(
    actor,
    {
      branchId: profile.branchId,
      reasonId: input.reasonId,
      priorityKey: reception.askPriority ? (input.priorityKey ?? null) : null,
      language: input.language,
      fields: input.fields,
      consent: input.consent,
      assignToAgentId: null,
      appointmentId: null,
      source: "agent",
      idempotencyKey: input.idempotencyKey,
    },
    { serve },
  );
}
