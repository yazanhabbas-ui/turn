import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  invites,
  oidcAccounts,
  passwordResetTokens,
  privacyRequests,
  sessions,
  userAvatars,
  users,
} from "@/db/schema";
import { assertManages } from "../admin/users";
import { auditMeta, orgOf, requirePermission, type Actor } from "../admin/actor";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { subjectRef } from "./subjects";

export const anonymizeUserInput = z.object({ reason: z.string().trim().min(3).max(500), confirm: z.literal(true) });

/** Shown wherever the account still appears (audit trail, ticket history, reports). */
export const ANONYMIZED_USER_NAME = { ar: "مستخدم محذوف", en: "Deleted user" };

/**
 * Removes the personal data of a DEACTIVATED staff account: name, email, phone, password, 2FA secret, picture, linked
 * sign-ins, sessions, reset tokens and the contact details of the invitation they accepted. The account row stays, so
 * tickets, events, shifts and audit entries keep pointing at "Deleted user" and the history stays intact. Audit entries
 * about the account lose their name/email/phone snapshots and the IP and browser of the entries it performed; what was
 * done, when and by which account id stays.
 */
export async function anonymizeUser(actor: Actor, id: string, input: z.infer<typeof anonymizeUserInput>) {
  requirePermission(actor, "users.manage");
  if (id === actor.auth.user.id) throw new AppError("conflict", { reason: "self" });
  return db().transaction(async (tx) => {
    const [u] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, orgOf(actor)), isNull(users.archivedAt)));
    if (!u) throw new AppError("not_found");
    await assertManages(actor, id, tx);
    if (u.isActive) throw new AppError("conflict", { reason: "user_active" });
    if (u.anonymizedAt) throw new AppError("conflict", { reason: "already_anonymized" });
    const now = new Date();
    await tx
      .update(users)
      .set({
        email: `anonymized-${u.id}@deleted.invalid`,
        displayName: ANONYMIZED_USER_NAME,
        nameSearch: "",
        phone: null,
        passwordHash: null,
        passwordChangedAt: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        avatarVersion: null,
        anonymizedAt: now,
      })
      .where(eq(users.id, id));
    await tx.delete(userAvatars).where(eq(userAvatars.userId, id));
    await tx.delete(oidcAccounts).where(eq(oidcAccounts.userId, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id));
    await tx.update(invites).set({ email: null, phone: null, displayName: null }).where(eq(invites.usedByUserId, id));
    await tx
      .update(auditLogs)
      .set({
        before: sql`case when jsonb_typeof(before) = 'object' then before - 'email' - 'displayName' - 'phone' - 'nameSearch' else before end`,
        after: sql`case when jsonb_typeof(after) = 'object' then after - 'email' - 'displayName' - 'phone' - 'nameSearch' else after end`,
      })
      .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, id)));
    await tx.update(auditLogs).set({ ip: null, userAgent: null }).where(eq(auditLogs.actorUserId, id));
    const ref = subjectRef("user", id);
    const [req] = await tx
      .insert(privacyRequests)
      .values({
        organizationId: orgOf(actor),
        type: "erasure",
        subjectKind: "user",
        subjectRef: ref,
        performedBy: actor.auth.user.id,
        completedAt: now,
        note: input.reason,
      })
      .returning({ id: privacyRequests.id });
    await audit(
      {
        ...auditMeta(actor),
        action: "privacy.user_anonymized",
        entityType: "user",
        entityId: id,
        after: { subjectRef: ref, requestId: req.id },
      },
      tx,
    );
    return { requestId: req.id };
  });
}
