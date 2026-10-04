import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, messageTemplates, queues, visitReasons, type displays } from "@/db/schema";
import { parseDisplayConfig } from "@/domain/display/config";
import { kioskAllows, kioskFields, kioskReasonState } from "@/domain/kiosk/self-service";
import { normalizePhone } from "@/domain/tickets/phone";
import { uuid } from "@/domain/validation";
import { LOCALE_CODES } from "@/i18n/locales";
import { hashPhone } from "../crypto";
import { AppError } from "../http/errors";
import { rateLimit } from "../rate-limit";
import { getSetting } from "../settings/service";
import { hiddenReasonIds } from "../queue/city-reasons";
import { issueTicketWith } from "../queue/tickets";
import { waitDisplayOf } from "../queue/wait-analytics";

type Device = typeof displays.$inferSelect;

/**
 * Everything the self check-in kiosk renders (D61): the reasons of its branch and what a visitor may type for each,
 * consent, wording and the kiosk options. Authenticated by the device token; contains no visitor data.
 */
export async function kioskContext(device: Device) {
  const org = device.organizationId;
  const branchId = device.branchId;
  const config = parseDisplayConfig(device.config);
  const [branch] = await db().select().from(branches).where(eq(branches.id, branchId));
  if (!branch || branch.archivedAt) throw new AppError("unauthorized");
  const [sc, privacy, regional, branding, ticketing, visitorStatus, wifi, wait, displayTheme] = await Promise.all([
    getSetting(org, "selfCheckin", branchId),
    getSetting(org, "privacy", branchId),
    getSetting(org, "regional", branchId),
    getSetting(org, "branding", branchId),
    getSetting(org, "ticketing", branchId),
    getSetting(org, "visitorStatus", branchId),
    getSetting(org, "wifi", branchId),
    getSetting(org, "waitEstimate", branchId),
    getSetting(org, "displayTheme", branchId),
  ]);
  const [reasonRows, queueRows, printTpl] = await Promise.all([
    db()
      .select()
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt)))
      .orderBy(asc(visitReasons.sortOrder), asc(visitReasons.createdAt)),
    db().select({ reasonId: queues.reasonId, isActive: queues.isActive }).from(queues).where(eq(queues.branchId, branchId)),
    db()
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.organizationId, org),
          eq(messageTemplates.channel, "ticket_print"),
          eq(messageTemplates.event, "ticket_issued"),
        ),
      ),
  ]);
  const hidden = await hiddenReasonIds(branch.cityId);
  const open = new Set(queueRows.filter((q) => q.isActive && !hidden.has(q.reasonId)).map((q) => q.reasonId));
  const reasons = sc.enabled
    ? reasonRows
        .filter((r) => open.has(r.id) && kioskAllows(sc.allowedReasons, r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          icon: r.icon,
          color: r.color,
          prefix: r.prefix,
          /** `ask_staff`: shown as "please ask the agent"; no ticket can be taken here. */
          state: kioskReasonState(r),
          intakeFields: kioskFields(r).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required })),
        }))
    : [];
  return {
    enabled: sc.enabled,
    device: { id: device.id, name: device.name },
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    options: {
      idleSeconds: sc.idleSeconds,
      showWait: sc.showWait,
      showQr: sc.showQr && visitorStatus.enabled,
      printTicket: sc.printTicket,
      welcomeText: sc.welcomeText,
    },
    /** The kiosk's own look when it chose one, else the organization or branch default. */
    theme: config.theme === "default" ? displayTheme.theme : config.theme,
    languages: config.languages,
    reasons,
    privacy: { consentText: privacy.consentText, requireConsent: privacy.requireConsent },
    regional: { digitsScreen: regional.digitsScreen, digitsTicket: regional.digitsTicket },
    waitDisplay: waitDisplayOf(wait),
    branding: {
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      ticketFooter: branding.ticketFooter,
    },
    ticketing: { showQrOnTicket: ticketing.showQrOnTicket },
    wifi,
    printTemplate: printTpl[0]?.body ?? null,
  };
}
export type KioskContext = Awaited<ReturnType<typeof kioskContext>>;

export const kioskIssueInput = z.object({
  reasonId: uuid,
  language: z.enum(LOCALE_CODES as [string, ...string[]]).default("ar"),
  fields: z.record(z.string(), z.string().max(200)).default({}),
  consent: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

/** A visitor takes a ticket at the kiosk. Same service as reception, with the self-service rules and abuse limits on top. */
export async function kioskIssue(device: Device, input: z.infer<typeof kioskIssueInput>) {
  const org = device.organizationId;
  const sc = await getSetting(org, "selfCheckin", device.branchId);
  if (!sc.enabled) throw new AppError("forbidden", { reason: "kiosk_disabled" });
  // One kiosk cannot be used to flood the queue.
  const rl = await rateLimit(`kiosk-issue:${device.id}`, sc.ratePerMinute, 60_000);
  if (!rl.ok) throw new AppError("rate_limited");

  const [reason] = await db()
    .select()
    .from(visitReasons)
    .where(and(eq(visitReasons.id, input.reasonId), eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt)));
  const [queue] = reason
    ? await db()
        .select({ isActive: queues.isActive })
        .from(queues)
        .where(and(eq(queues.branchId, device.branchId), eq(queues.reasonId, reason.id)))
    : [];
  if (!reason || !queue?.isActive || !kioskAllows(sc.allowedReasons, reason.id))
    throw new AppError("validation", { field: "reasonId" });
  if (kioskReasonState(reason) !== "available") throw new AppError("forbidden", { reason: "ask_staff" });

  // Only the fields a visitor may enter alone are accepted, whatever the request says.
  const allowed = new Set(kioskFields(reason).map((f) => f.key));
  for (const [k, v] of Object.entries(input.fields))
    if (v.trim() && !allowed.has(k)) throw new AppError("validation", { reason: "unexpected_field", field: k });

  if (input.fields.phone?.trim()) {
    const { phoneCountryCode } = await getSetting(org, "regional", device.branchId);
    const phone = normalizePhone(input.fields.phone, phoneCountryCode);
    // The same phone number cannot flood the queue either (a repeat while still waiting returns the ticket it has).
    if (phone && !(await rateLimit(`kiosk-phone:${hashPhone(phone)}`, 3, 60_000)).ok) throw new AppError("rate_limited");
  }

  const res = await issueTicketWith(
    { system: true, deviceId: device.id },
    {
      branchId: device.branchId,
      reasonId: reason.id,
      priorityKey: null,
      language: input.language,
      fields: input.fields,
      consent: input.consent,
      assignToAgentId: null,
      appointmentId: null,
      source: "kiosk",
      idempotencyKey: input.idempotencyKey,
    },
    { dedupePhone: true, maxWaiting: sc.maxWaiting, organizationId: org },
  );
  // The kiosk shows the number and the wait; it never receives the visitor's personal data back.
  return {
    duplicate: res.duplicate,
    ticket: {
      id: res.ticket.id,
      displayNumber: res.ticket.displayNumber,
      publicToken: res.ticket.publicToken,
      language: res.ticket.language,
      reasonId: res.ticket.reasonId,
      arrivedAt: res.ticket.arrivedAt,
    },
    ahead: res.ahead,
    estimatedWaitMinutes: res.estimatedWaitMinutes,
    waitLow: res.waitLow,
    waitHigh: res.waitHigh,
  };
}
