import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  announcements,
  branches,
  desks,
  hallSessions,
  halls,
  messageTemplates,
  ttsAudioPacks,
  tickets,
  visitReasons,
} from "@/db/schema";
import { resolveSurfaceTheme } from "@/domain/branding/surface-theme";
import { parseDisplayConfig } from "@/domain/display/config";
import { now as clockNow } from "../clock";
import { getSetting } from "../settings/service";
import { loadBranchContext } from "../queue/snapshot";
import type { DisplayRow } from "./device";

/** Number of past calls shown in the "recent" strip. */
const RECENT_CALLS = 5;

/**
 * Everything a waiting-room screen renders, in one response. Contains no personal data: only ticket numbers,
 * desks, reasons and counts. The screen never computes queue state itself.
 */
export async function displayState(display: DisplayRow) {
  const org = display.organizationId;
  const config = parseDisplayConfig(display.config);
  const now = clockNow();

  const [branch] = await db().select().from(branches).where(eq(branches.id, display.branchId));
  const [branding, regional, voice, displayTheme, bctx] = await Promise.all([
    getSetting(org, "branding", display.branchId),
    getSetting(org, "regional", display.branchId),
    getSetting(org, "voice", display.branchId),
    getSetting(org, "displayTheme", display.branchId),
    db().transaction((tx) => loadBranchContext(tx, display.branchId, now)),
  ]);

  const deskRows = await db()
    .select()
    .from(desks)
    .where(and(eq(desks.branchId, display.branchId), isNull(desks.archivedAt)))
    .orderBy(asc(desks.sortOrder), asc(desks.number));
  const shownDesks = config.zones.length ? deskRows.filter((d) => d.zone && config.zones.includes(d.zone)) : deskRows;
  const deskIds = new Set(shownDesks.map((d) => d.id));

  const reasonRows = await db()
    .select()
    .from(visitReasons)
    .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt)))
    .orderBy(asc(visitReasons.sortOrder));

  const active = await db()
    .select({
      id: tickets.id,
      displayNumber: tickets.displayNumber,
      status: tickets.status,
      deskId: tickets.deskId,
      hallId: tickets.hallId,
      hallSessionId: tickets.hallSessionId,
    })
    .from(tickets)
    .where(and(eq(tickets.branchId, display.branchId), inArray(tickets.status, ["CALLED", "SERVING"])))
    .orderBy(desc(tickets.calledAt));
  const recentRows = await db()
    .select({
      id: tickets.id,
      displayNumber: tickets.displayNumber,
      status: tickets.status,
      deskId: tickets.deskId,
      hallId: tickets.hallId,
      hallSessionId: tickets.hallSessionId,
      calledAt: tickets.calledAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.branchId, display.branchId),
        or(eq(tickets.serviceDay, bctx.serviceDay), inArray(tickets.status, ["CALLED", "SERVING"])),
        sql`${tickets.calledAt} is not null`,
        or(sql`${tickets.deskId} is not null`, sql`${tickets.hallId} is not null`),
      ),
    )
    .orderBy(desc(tickets.calledAt))
    .limit(RECENT_CALLS * 12);

  // An agent may have several visitors at once: every ticket at a desk is shown on it.
  const byDesk = new Map<string, typeof active>();
  for (const t of active) if (t.deskId && !t.hallId) byDesk.set(t.deskId, [...(byDesk.get(t.deskId) ?? []), t]);
  const deskList = shownDesks.map((d) => {
    const here = byDesk.get(d.id) ?? [];
    const t = here[0];
    return {
      id: d.id,
      number: d.number,
      name: d.name,
      zone: d.zone,
      status: here.length ? (here.some((x) => x.status === "CALLED") ? "called" : "serving") : "free",
      displayNumber: t?.displayNumber ?? null,
      /** Further visitors at the same desk (agents that serve several at once). */
      otherNumbers: here.slice(1).map((x) => x.displayNumber),
      ticketId: t?.id ?? null,
    };
  });

  // Halls (D62): only when the branch has halls and the feature is on, so a desks-only branch is unchanged.
  const hallsOn = bctx.hallSettings.enabled && bctx.halls.length > 0;
  const hallRows = hallsOn
    ? await db()
        .select()
        .from(halls)
        .where(and(eq(halls.branchId, display.branchId), isNull(halls.archivedAt)))
        .orderBy(asc(halls.sortOrder), asc(halls.number))
    : [];
  const shownHalls = config.zones.length ? hallRows.filter((h) => h.zone && config.zones.includes(h.zone)) : hallRows;
  const hallIds = new Set(shownHalls.map((h) => h.id));
  const liveSessions = hallsOn
    ? await db()
        .select({ id: hallSessions.id, hallId: hallSessions.hallId, status: hallSessions.status })
        .from(hallSessions)
        .where(and(eq(hallSessions.branchId, display.branchId), inArray(hallSessions.status, ["OPEN", "IN_SESSION"])))
    : [];
  const sessionByHall = new Map(liveSessions.map((s) => [s.hallId, s]));
  const hallList = shownHalls.map((h) => {
    const here = active
      .filter((t) => t.hallId === h.id)
      .sort((x, y) => x.displayNumber.localeCompare(y.displayNumber, "en", { numeric: true }));
    const session = sessionByHall.get(h.id);
    return {
      id: h.id,
      number: h.number,
      name: h.name,
      zone: h.zone,
      capacity: h.capacity,
      status: !session ? "free" : session.status === "IN_SESSION" ? "in_session" : "called",
      /** The visitors called to the hall or inside it, in number order. */
      numbers: here.map((t) => t.displayNumber),
      occupied: here.length,
      sessionId: session?.id ?? null,
    } as const;
  });

  const waitingByReason = new Map<string, number>();
  for (const t of bctx.snapshot.tickets) {
    if (t.status === "WAITING") waitingByReason.set(t.reasonId, (waitingByReason.get(t.reasonId) ?? 0) + 1);
  }
  const reasons = reasonRows
    .filter((r) => bctx.snapshot.reasons.has(r.id))
    .map((r) => {
      const waiting = waitingByReason.get(r.id) ?? 0;
      const agents = bctx.snapshot.agents.filter(
        (a) => a.skills.has(r.id) && (a.status === "AVAILABLE" || a.status === "BUSY"),
      ).length;
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        prefix: r.prefix,
        waiting,
        estimatedWaitMinutes: bctx.waitFor(r.id, waiting, agents).minutes,
      };
    });

  const nowDate = new Date(now);
  const slides =
    config.showTicker || config.showSlides
      ? await db()
          .select()
          .from(announcements)
          .where(
            and(
              eq(announcements.organizationId, org),
              eq(announcements.isActive, true),
              or(isNull(announcements.branchId), eq(announcements.branchId, display.branchId)),
              or(isNull(announcements.startsAt), sql`${announcements.startsAt} <= ${nowDate}`),
              or(isNull(announcements.endsAt), sql`${announcements.endsAt} >= ${nowDate}`),
            ),
          )
          .orderBy(asc(announcements.sortOrder), asc(announcements.createdAt))
      : [];

  const [voiceTemplates, packs] = await Promise.all([
    db()
      .select({ event: messageTemplates.event, body: messageTemplates.body, cityId: messageTemplates.cityId })
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.organizationId, org),
          eq(messageTemplates.channel, "voice"),
          eq(messageTemplates.isActive, true),
          or(isNull(messageTemplates.cityId), eq(messageTemplates.cityId, branch.cityId)),
        ),
      ),
    voice.provider === "pack"
      ? db()
          .select({ locale: ttsAudioPacks.locale, manifest: ttsAudioPacks.manifest })
          .from(ttsAudioPacks)
          .where(and(eq(ttsAudioPacks.organizationId, org), eq(ttsAudioPacks.isActive, true)))
      : Promise.resolve([] as { locale: string; manifest: Record<string, string> }[]),
  ]);

  const deskById = new Map(deskRows.map((d) => [d.id, d]));
  const hallById = new Map(hallRows.map((h) => [h.id, h]));
  // A group call counts once: the last RECENT_CALLS calls (a desk call or a whole hall group), every ticket of each.
  const seenCalls = new Set<string>();
  const recent = recentRows
    .filter((t) => {
      if (t.hallId) return hallsOn && (config.zones.length ? hallIds.has(t.hallId) : true);
      return config.zones.length ? deskIds.has(t.deskId!) : true;
    })
    .filter((t) => {
      const key = t.hallSessionId ?? t.id;
      if (seenCalls.has(key)) return true;
      if (seenCalls.size >= RECENT_CALLS) return false;
      seenCalls.add(key);
      return true;
    })
    .map((t) => ({
      ticketId: t.id,
      displayNumber: t.displayNumber,
      status: t.status,
      deskNumber: t.hallId ? null : (deskById.get(t.deskId!)?.number ?? null),
      hallId: t.hallId ?? null,
      hallSessionId: t.hallSessionId ?? null,
      hallNumber: t.hallId ? (hallById.get(t.hallId)?.number ?? null) : null,
      calledAt: t.calledAt?.toISOString() ?? null,
    }));

  return {
    now: new Date(now).toISOString(),
    display: {
      id: display.id,
      name: display.name,
      layout: display.layout,
      config,
      /** The look in effect: the screen's own choice, or the organization / branch default. */
      theme: resolveSurfaceTheme(config.theme, displayTheme.theme),
    },
    branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
    branding: {
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      font: branding.font,
      welcomeText: branding.welcomeText,
    },
    regional: {
      digitsScreen: regional.digitsScreen,
      digitsVoice: regional.digitsVoice,
      timeFormat: regional.timeFormat,
      showHijri: regional.showHijri,
    },
    desks: deskList,
    halls: hallList,
    /** How the screen announces and shows a group call (the branch's `halls` setting). */
    hallsConfig: { enabled: hallsOn, announceMode: bctx.hallSettings.announceMode, maxAnnounced: bctx.hallSettings.maxAnnounced },
    recent,
    reasons,
    waitingTotal: [...waitingByReason.values()].reduce((a, b) => a + b, 0),
    ticker: config.showTicker ? slides.filter((s) => s.kind === "ticker").map((s) => ({ id: s.id, body: s.body })) : [],
    slides: config.showSlides
      ? slides
          .filter((s) => s.kind === "slide")
          .map((s) => ({ id: s.id, body: s.body, mediaUrl: s.mediaUrl, durationSeconds: s.durationSeconds }))
      : [],
    voice: {
      settings: {
        ...voice,
        enabled: config.voice.enabled ?? voice.enabled,
        volume: config.voice.volume ?? voice.volume,
        rate: config.voice.rate ?? voice.rate,
        callLanguages: config.voice.callLanguages ?? voice.callLanguages,
        repeat: config.voice.repeat ?? voice.repeat,
      },
      templates: Object.fromEntries(
        // A city's own wording is listed last so it wins over the organization's for the same event.
        [...voiceTemplates].sort((a, b) => Number(a.cityId !== null) - Number(b.cityId !== null)).map((t) => [t.event, t.body]),
      ),
      packs: Object.fromEntries(packs.map((p) => [p.locale, p.manifest])),
    },
  };
}

export type DisplayState = Awaited<ReturnType<typeof displayState>>;
