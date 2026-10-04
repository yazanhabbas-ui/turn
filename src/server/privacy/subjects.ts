import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  appointments,
  branches,
  csatResponses,
  notificationsLog,
  privacyRequests,
  tickets,
  users,
  visitReasons,
  visitors,
} from "@/db/schema";
import { nameSkeleton, normalizeArabic } from "@/domain/i18n/arabic-normalize";
import { normalizePhone } from "@/domain/tickets/phone";
import { audit } from "../audit";
import { allowedBranches, auditMeta, orgOf, requirePermission, type Actor } from "../admin/actor";
import { hashPhone } from "../crypto";
import { env } from "../env";
import { AppError } from "../http/errors";
import { guardFormula } from "../reports/export";
import { getSetting } from "../settings/service";

/**
 * Data-subject requests for visitors (D56). Scope: `visitors.privacy`. An organization-wide holder works on every
 * visitor. A holder for some branches (a city or branch admin) only reaches visitors whose tickets are ALL in those
 * branches (a visitor who also came to another branch is not found), and never visitors without any ticket.
 * Nothing here writes personal data to the audit trail or to `privacy_requests`: only a keyed hash of the visitor id.
 */

/** Keyed hash that identifies a subject in the audit trail and the request history without exposing who it is. */
export function subjectRef(kind: "visitor" | "user", id: string): string {
  return createHmac("sha256", env().PHONE_HASH_KEY).update(`subject:${kind}:${id}`).digest("hex").slice(0, 32);
}

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

/** SQL condition limiting visitors to the actor's scope; null = no limit. */
function scopeCondition(actor: Actor): SQL | null {
  const scope = allowedBranches(actor, "visitors.privacy");
  if (scope === "all") return null;
  if (scope.length === 0) return sql`false`;
  return sql`(exists (select 1 from tickets sx where sx.visitor_id = ${visitors.id} and sx.branch_id in (${uuidList(scope)}))
    and not exists (select 1 from tickets sy where sy.visitor_id = ${visitors.id} and sy.branch_id not in (${uuidList(scope)})))`;
}

async function loadVisitor(actor: Actor, id: string) {
  requirePermission(actor, "visitors.privacy");
  const scope = scopeCondition(actor);
  const [row] = await db()
    .select()
    .from(visitors)
    .where(and(eq(visitors.id, id), eq(visitors.organizationId, orgOf(actor)), ...(scope ? [scope] : [])));
  if (!row) throw new AppError("not_found");
  return row;
}

export type SubjectView = {
  id: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  visitCount: number;
  lastVisitAt: string | null;
  createdAt: string;
  anonymizedAt: string | null;
  notificationsOptOut: boolean;
  held: {
    tickets: number;
    ticketsWithData: number;
    appointments: number;
    feedback: number;
    comments: number;
    notifications: number;
  };
};

async function describe(v: typeof visitors.$inferSelect): Promise<SubjectView> {
  const r = await db().execute<Record<string, string>>(sql`
    select
      (select count(*) from tickets where visitor_id = ${v.id}) as tickets,
      (select count(*) from tickets where visitor_id = ${v.id} and (intake <> '{}'::jsonb or notes is not null)) as tickets_with_data,
      (select count(*) from appointments where visitor_id = ${v.id}) as appointments,
      (select count(*) from csat_responses where ticket_id in (select id from tickets where visitor_id = ${v.id})) as feedback,
      (select count(*) from csat_responses where comment is not null and ticket_id in (select id from tickets where visitor_id = ${v.id})) as comments,
      (select count(*) from notifications_log where ticket_id in (select id from tickets where visitor_id = ${v.id})) as notifications`);
  const h = r.rows[0] ?? {};
  return {
    id: v.id,
    name: v.name,
    phone: v.phone,
    company: v.company,
    visitCount: v.visitCount,
    lastVisitAt: v.lastVisitAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    anonymizedAt: v.anonymizedAt?.toISOString() ?? null,
    notificationsOptOut: v.notificationsOptOut,
    held: {
      tickets: Number(h.tickets ?? 0),
      ticketsWithData: Number(h.tickets_with_data ?? 0),
      appointments: Number(h.appointments ?? 0),
      feedback: Number(h.feedback ?? 0),
      comments: Number(h.comments ?? 0),
      notifications: Number(h.notifications ?? 0),
    },
  };
}

/** Finds visitors by phone number (exact, any common notation), name (Arabic-insensitive, also Latin spelling) or ticket number. */
export async function findSubjects(actor: Actor, rawQuery: string): Promise<SubjectView[]> {
  requirePermission(actor, "visitors.privacy");
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const org = orgOf(actor);
  const { phoneCountryCode } = await getSetting(org, "regional");
  const phone = normalizePhone(q, phoneCountryCode);
  const folded = normalizeArabic(q);
  const skeleton = nameSkeleton(q);
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const matches: SQL[] = [];
  if (phone) matches.push(eq(visitors.phoneHash, hashPhone(phone)));
  if (folded) matches.push(sql`${visitors.nameSearch} like ${like(folded)}`);
  if (skeleton) matches.push(sql`${visitors.nameTranslit} like ${like(skeleton)}`);
  matches.push(
    sql`${visitors.id} in (select visitor_id from tickets where organization_id = ${org} and lower(display_number) = ${q.toLowerCase()})`,
  );
  const scope = scopeCondition(actor);
  const rows = await db()
    .select()
    .from(visitors)
    .where(and(eq(visitors.organizationId, org), or(...matches), ...(scope ? [scope] : [])))
    .orderBy(desc(visitors.lastVisitAt), desc(visitors.createdAt))
    .limit(25);
  return Promise.all(rows.map(describe));
}

export async function subjectDetails(actor: Actor, id: string): Promise<SubjectView> {
  return describe(await loadVisitor(actor, id));
}

/* ---------- access export ---------- */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type SubjectExport = {
  generatedAt: string;
  subject: Record<string, Json>;
  tickets: Record<string, Json>[];
  appointments: Record<string, Json>[];
  feedback: Record<string, Json>[];
  notifications: Record<string, Json>[];
};

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Everything held about one visitor. Notification entries are metadata only (masked recipient, status, time). */
export async function collectSubjectData(v: typeof visitors.$inferSelect): Promise<SubjectExport> {
  const t = await db()
    .select({ ticket: tickets, branchName: branches.name, reasonName: visitReasons.name, reasonCode: visitReasons.code })
    .from(tickets)
    .innerJoin(branches, eq(branches.id, tickets.branchId))
    .innerJoin(visitReasons, eq(visitReasons.id, tickets.reasonId))
    .where(eq(tickets.visitorId, v.id))
    .orderBy(tickets.arrivedAt);
  const ids = t.map((x) => x.ticket.id);
  const numberOf = new Map(t.map((x) => [x.ticket.id, x.ticket.displayNumber]));
  const [feedback, notes, appts] = await Promise.all([
    ids.length ? db().select().from(csatResponses).where(inArray(csatResponses.ticketId, ids)) : [],
    ids.length ? db().select().from(notificationsLog).where(inArray(notificationsLog.ticketId, ids)) : [],
    db().select().from(appointments).where(eq(appointments.visitorId, v.id)),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    subject: {
      id: v.id,
      name: v.name,
      phone: v.phone,
      company: v.company,
      preferredLanguage: v.preferredLanguage,
      visitCount: v.visitCount,
      firstSeenAt: iso(v.createdAt),
      lastVisitAt: iso(v.lastVisitAt),
      notificationsOptOut: v.notificationsOptOut,
      anonymizedAt: iso(v.anonymizedAt),
    },
    tickets: t.map(({ ticket: x, branchName, reasonName, reasonCode }) => ({
      number: x.displayNumber,
      serviceDay: x.serviceDay,
      branch: branchName,
      reason: reasonName,
      reasonCode,
      status: x.status,
      priority: x.priorityKey,
      language: x.language,
      source: x.source,
      arrivedAt: iso(x.arrivedAt),
      calledAt: iso(x.calledAt),
      startedAt: iso(x.startedAt),
      finishedAt: iso(x.finishedAt),
      outcome: x.outcome,
      notes: x.notes,
      intake: x.intake,
      consentAt: iso(x.consentAt),
    })),
    appointments: appts.map((a) => ({ code: a.code, scheduledAt: iso(a.scheduledAt), status: a.status, notes: a.notes })),
    feedback: feedback.map((f) => ({
      ticket: numberOf.get(f.ticketId) ?? null,
      score: f.score,
      nps: f.nps,
      comment: f.comment,
      channel: f.channel,
      at: iso(f.at),
    })),
    notifications: notes.map((n) => ({
      ticket: n.ticketId ? (numberOf.get(n.ticketId) ?? null) : null,
      channel: n.channel,
      event: n.event,
      recipient: n.recipientMasked,
      status: n.status,
      createdAt: iso(n.createdAt),
      sentAt: iso(n.sentAt),
    })),
  };
}

function flat(value: Json, path = ""): [string, string][] {
  if (value === null || value === undefined) return [[path, ""]];
  if (Array.isArray(value)) return value.flatMap((v, i) => flat(v, `${path}[${i}]`));
  if (typeof value === "object") return Object.entries(value).flatMap(([k, v]) => flat(v, path ? `${path}.${k}` : k));
  return [[path, String(value)]];
}

const cell = (s: string) => {
  const text = guardFormula(s);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Long CSV (section, record, field, value): one file holds every kind of record without empty columns. */
export function subjectCsv(data: SubjectExport): string {
  const lines = ["section,record,field,value"];
  const add = (section: string, record: number, obj: Record<string, Json>) => {
    for (const [field, value] of flat(obj)) lines.push([section, String(record), field, value].map(cell).join(","));
  };
  add("subject", 1, data.subject);
  for (const key of ["tickets", "appointments", "feedback", "notifications"] as const)
    data[key].forEach((row, i) => add(key, i + 1, row));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export const exportInput = z.object({ format: z.enum(["json", "csv"]).default("json") });

/** Access request: returns the file content and records the request (type `access`) and an audit entry without personal data. */
export async function exportSubject(actor: Actor, id: string, input: z.infer<typeof exportInput>) {
  const v = await loadVisitor(actor, id);
  const data = await collectSubjectData(v);
  const ref = subjectRef("visitor", v.id);
  await db().transaction(async (tx) => {
    const [req] = await tx
      .insert(privacyRequests)
      .values({
        organizationId: orgOf(actor),
        type: "access",
        subjectRef: ref,
        performedBy: actor.auth.user.id,
        completedAt: new Date(),
        summary: {
          format: input.format,
          tickets: data.tickets.length,
          feedback: data.feedback.length,
          notifications: data.notifications.length,
        },
      })
      .returning({ id: privacyRequests.id });
    await audit(
      {
        ...auditMeta(actor),
        action: "privacy.access_exported",
        entityType: "privacy_request",
        entityId: req.id,
        after: { subjectRef: ref, format: input.format },
      },
      tx,
    );
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return input.format === "csv"
    ? { filename: `dor-subject-data-${stamp}.csv`, mime: "text/csv;charset=utf-8", content: subjectCsv(data) }
    : { filename: `dor-subject-data-${stamp}.json`, mime: "application/json", content: JSON.stringify(data, null, 2) };
}

/* ---------- erasure ---------- */

export const erasureInput = z.object({
  reason: z.string().trim().min(3).max(500),
  /** Must be true: the interface asks the administrator to confirm. */
  confirm: z.literal(true),
});

export type ErasureResult = {
  requestId: string;
  cleared: { visitor: number; tickets: number; appointments: number; comments: number; notifications: number };
};

/**
 * Erasure request: anonymises the visitor now (name, phone, phone hash, company), clears the free text of their tickets
 * and appointments, their feedback comments and the recipients/payloads of their notifications, and switches
 * notifications off for them. Tickets, scores and delivery statuses stay, so reports do not change.
 */
export async function eraseSubject(actor: Actor, id: string, input: z.infer<typeof erasureInput>): Promise<ErasureResult> {
  const v = await loadVisitor(actor, id);
  const ref = subjectRef("visitor", v.id);
  return db().transaction(async (tx) => {
    const mine = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.visitorId, v.id));
    const ids = mine.map((m) => m.id);
    const now = new Date();
    const cleared = { visitor: 0, tickets: 0, appointments: 0, comments: 0, notifications: 0 };
    const [hit] = await tx
      .update(visitors)
      .set({
        name: null,
        nameSearch: null,
        nameTranslit: null,
        phone: null,
        phoneHash: null,
        company: null,
        lastAgentId: null,
        anonymizedAt: v.anonymizedAt ?? now,
        notificationsOptOut: true,
        notificationsOptOutAt: v.notificationsOptOutAt ?? now,
      })
      .where(eq(visitors.id, v.id))
      .returning({ id: visitors.id });
    cleared.visitor = hit ? 1 : 0;
    cleared.appointments =
      (
        await tx
          .update(appointments)
          .set({ notes: null })
          .where(and(eq(appointments.visitorId, v.id), sql`${appointments.notes} is not null`))
      ).rowCount ?? 0;
    if (ids.length) {
      cleared.tickets =
        (
          await tx
            .update(tickets)
            .set({ intake: {}, notes: null, callCode: null })
            .where(
              and(
                inArray(tickets.id, ids),
                sql`(${tickets.intake} <> '{}'::jsonb or ${tickets.notes} is not null or ${tickets.callCode} is not null)`,
              ),
            )
        ).rowCount ?? 0;
      cleared.comments =
        (
          await tx
            .update(csatResponses)
            .set({ comment: null })
            .where(and(inArray(csatResponses.ticketId, ids), sql`${csatResponses.comment} is not null`))
        ).rowCount ?? 0;
      // Messages still waiting are cancelled; the rest lose their recipient and variables.
      await tx
        .update(notificationsLog)
        .set({ status: "skipped", error: "opted_out" })
        .where(and(inArray(notificationsLog.ticketId, ids), inArray(notificationsLog.status, ["queued", "sending"])));
      cleared.notifications =
        (
          await tx
            .update(notificationsLog)
            .set({ recipientMasked: null, payload: {} })
            .where(
              and(
                inArray(notificationsLog.ticketId, ids),
                sql`(${notificationsLog.recipientMasked} is not null or ${notificationsLog.payload} <> '{}'::jsonb)`,
              ),
            )
        ).rowCount ?? 0;
    }
    const [req] = await tx
      .insert(privacyRequests)
      .values({
        organizationId: orgOf(actor),
        type: "erasure",
        subjectRef: ref,
        performedBy: actor.auth.user.id,
        completedAt: now,
        note: input.reason,
        summary: cleared,
      })
      .returning({ id: privacyRequests.id });
    await audit(
      {
        ...auditMeta(actor),
        action: "privacy.erasure",
        entityType: "privacy_request",
        entityId: req.id,
        after: { subjectRef: ref, cleared },
      },
      tx,
    );
    return { requestId: req.id, cleared };
  });
}

/* ---------- history ---------- */

/** Request history. Organization-wide holders see every request; others only the ones they performed. */
export async function listRequests(actor: Actor, limit = 100) {
  requirePermission(actor, "visitors.privacy");
  const all = allowedBranches(actor, "visitors.privacy") === "all";
  const rows = await db()
    .select({
      id: privacyRequests.id,
      type: privacyRequests.type,
      status: privacyRequests.status,
      subjectKind: privacyRequests.subjectKind,
      subjectRef: privacyRequests.subjectRef,
      requestedAt: privacyRequests.requestedAt,
      completedAt: privacyRequests.completedAt,
      note: privacyRequests.note,
      summary: privacyRequests.summary,
      performedBy: users.displayName,
    })
    .from(privacyRequests)
    .leftJoin(users, eq(users.id, privacyRequests.performedBy))
    .where(
      and(
        eq(privacyRequests.organizationId, orgOf(actor)),
        ...(all ? [] : [eq(privacyRequests.performedBy, actor.auth.user.id)]),
      ),
    )
    .orderBy(desc(privacyRequests.requestedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, requestedAt: r.requestedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }));
}
