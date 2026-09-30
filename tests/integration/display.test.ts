import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, branches, displays, desks, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import {
  activateAudioPack,
  addBundledVoices,
  listAudioPacks,
  announcementInput,
  audioPackInput,
  createDisplay,
  deleteAnnouncement,
  deleteDisplay,
  listDisplays,
  listTemplates,
  newPairingCode,
  revokeDisplay,
  saveAnnouncement,
  saveAudioPack,
  saveTemplate,
  updateDisplay,
} from "@/server/admin/screens";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, now, setClock } from "@/server/clock";
import { authenticateDevice, pairDevice } from "@/server/display/device";
import { displayState } from "@/server/display/state";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, setAgentStatus } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const meta = { ip: "10.0.0.5", userAgent: "vitest-tv" };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("display screens (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

  const input = (over: Record<string, unknown> = {}) => ({
    name: "Lobby TV",
    branchId,
    layout: "classic" as const,
    config: {
      languages: ["ar", "en"] as ("ar" | "en")[],
      rotateSeconds: 15,
      zones: [],
      showTicker: true,
      showSlides: true,
      showWaiting: true,
      showClock: true,
      voice: {},
    },
    ...over,
  });

  async function pairedScreen(over: Record<string, unknown> = {}) {
    const created = await createDisplay(admin, input(over));
    const { token } = await pairDevice(created.pairingCode, meta);
    return { id: created.id, token, display: await authenticateDevice(token) };
  }

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Riyadh"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("pairs with a single-use code and exchanges it for a device token stored only as a hash", async () => {
    const created = await createDisplay(admin, input());
    expect(created.pairingCode).toMatch(/^[2-9A-Z]{6}$/);
    let [row] = await db().select().from(displays).where(eq(displays.id, created.id));
    expect(row.tokenHash).toBeNull();

    await expectCode(pairDevice("WRONG1", meta), "not_found");
    const { token } = await pairDevice(` ${created.pairingCode.toLowerCase()} `, meta);
    [row] = await db().select().from(displays).where(eq(displays.id, created.id));
    expect(row.tokenHash).toBeTruthy();
    expect(row.tokenHash).not.toBe(token);
    expect(row.pairingCode).toBeNull();
    expect((await authenticateDevice(token)).id).toBe(created.id);

    // The code cannot be used twice.
    await expectCode(pairDevice(created.pairingCode, meta), "not_found");
    const [item] = (await listDisplays(admin)).filter((d) => d.id === created.id);
    expect(item).toMatchObject({ paired: true, online: true, revoked: false, pairingCode: null });
    expect(JSON.stringify(item)).not.toContain(token);
  });

  it("rejects expired pairing codes and issues a new one on request", async () => {
    const created = await createDisplay(admin, input());
    await db()
      .update(displays)
      .set({ pairingExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(displays.id, created.id));
    await expectCode(pairDevice(created.pairingCode, meta), "not_found");
    const fresh = await newPairingCode(admin, created.id);
    expect(await pairDevice(fresh.pairingCode, meta)).toMatchObject({ displayId: created.id });
  });

  it("pairing again replaces the old token, and revoking kills the current one at once", async () => {
    const first = await pairedScreen();
    const again = await newPairingCode(admin, first.id);
    const second = await pairDevice(again.pairingCode, meta);
    await expectCode(authenticateDevice(first.token), "unauthorized");
    expect((await authenticateDevice(second.token)).id).toBe(first.id);

    await revokeDisplay(admin, first.id);
    await expectCode(authenticateDevice(second.token), "unauthorized");
    expect((await listDisplays(admin)).find((d) => d.id === first.id)).toMatchObject({
      paired: false,
      revoked: true,
      online: false,
    });
    // A revoked screen can be paired again with a new code.
    const code = await newPairingCode(admin, first.id);
    expect((await authenticateDevice((await pairDevice(code.pairingCode, meta)).token)).id).toBe(first.id);
  });

  it("only people with displays.manage can manage screens", async () => {
    await expectCode(createDisplay(reception, input()), "forbidden");
    await expectCode(listDisplays(khalid), "forbidden");
    await expectCode(authenticateDevice(null), "unauthorized");
    await expectCode(authenticateDevice("not-a-token"), "unauthorized");
    const { id } = await createDisplay(admin, input());
    await expectCode(updateDisplay(reception, id, input({ name: "x" })), "forbidden");
    await deleteDisplay(admin, id);
    expect((await listDisplays(admin)).find((d) => d.id === id)).toBeUndefined();
  });

  it("audits screen management without ever storing token hashes", async () => {
    const { id } = await pairedScreen();
    await revokeDisplay(admin, id);
    const rows = await db().select().from(auditLogs).where(eq(auditLogs.entityType, "display"));
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["display.created", "display.paired", "display.revoked"]));
    expect(JSON.stringify(rows)).not.toMatch(/tokenHash|token_hash/);
  });

  it("the state shows desks, calls, recent calls and waiting counts and contains no personal data", async () => {
    const screen = await pairedScreen();
    await setAgentStatus(khalid, { status: "AVAILABLE" });
    const issue = (code: string, fields: Record<string, string> = {}, consent = false) =>
      issueTicket(reception, { branchId, reasonId: reason[code], language: "ar", fields, consent, source: "reception" });
    const t1 = await issue("contract", { name: "فهد السري", phone: "0501234567", national_id_last4: "9876" }, true);
    advanceClock(0.1); // tickets issued in the same millisecond have no defined order
    await issue("general");
    const called = await callNext(khalid, {});
    expect(called.ticket?.id).toBe(t1.ticket.id);

    const state = await displayState(screen.display);
    const serving = state.desks.find((d) => d.displayNumber === t1.ticket.displayNumber);
    expect(serving).toMatchObject({ status: "called" });
    expect(state.recent[0]).toMatchObject({ displayNumber: t1.ticket.displayNumber });
    expect(state.recent[0].deskNumber).toBe(serving!.number);
    expect(state.waitingTotal).toBe(1);
    expect(state.reasons.find((r) => r.id === reason.general)).toMatchObject({ waiting: 1 });
    expect(state.branch.timezone).toBe("Asia/Riyadh");
    expect(state.voice.templates.ticket_called.ar).toContain("{ticket}");
    expect(state.voice.settings).toMatchObject({ enabled: true, repeat: 2, mode: "sequence" });

    const json = JSON.stringify(state);
    for (const secret of ["فهد السري", "0501234567", "9876", "publicToken", "intake"]) expect(json).not.toContain(secret);
  });

  it("filters desks by zone and applies per-screen voice overrides", async () => {
    const screen = await pairedScreen({
      config: { ...input().config, zones: ["B"], voice: { volume: 0.4, enabled: false } },
    });
    const zoneB = await db().select().from(desks).where(eq(desks.zone, "B"));
    const state = await displayState(screen.display);
    expect(state.desks.map((d) => d.id).sort()).toEqual(zoneB.map((d) => d.id).sort());
    expect(state.voice.settings).toMatchObject({ volume: 0.4, enabled: false });
  });

  it("serves active ticker lines and slides only, and refuses external media", async () => {
    const screen = await pairedScreen();
    const base = { durationSeconds: 8, sortOrder: 0, isActive: true };
    await saveAnnouncement(admin, null, { ...base, kind: "ticker", body: { ar: "مرحباً بكم", en: "Welcome" } });
    await saveAnnouncement(admin, null, { ...base, kind: "ticker", body: { ar: "معطل" }, isActive: false });
    await saveAnnouncement(admin, null, {
      ...base,
      kind: "ticker",
      body: { ar: "منتهي" },
      endsAt: new Date(now() - 3600_000).toISOString(),
    });
    const slide = await saveAnnouncement(admin, null, { ...base, kind: "slide", body: { ar: "عرض" }, mediaUrl: "/promo.png" });
    expect(
      announcementInput.safeParse({ ...base, kind: "slide", body: { ar: "x" }, mediaUrl: "https://cdn.example.com/x.png" })
        .success,
    ).toBe(false);

    let state = await displayState(screen.display);
    const ticker = state.ticker.map((x) => x.body.ar);
    expect(ticker).toContain("مرحباً بكم");
    expect(ticker).not.toContain("معطل");
    expect(ticker).not.toContain("منتهي");
    expect(state.slides).toHaveLength(1);
    expect(state.slides[0].mediaUrl).toBe("/promo.png");

    await deleteAnnouncement(admin, slide.id);
    await updateDisplay(admin, screen.id, input({ config: { ...input().config, showTicker: false } }));
    state = await displayState((await authenticateDevice(screen.token))!);
    expect(state.slides).toHaveLength(0);
    expect(state.ticker).toHaveLength(0);
  });

  it("editable voice phrases and audio packs reach the screen", async () => {
    const screen = await pairedScreen();
    await saveTemplate(admin, {
      channel: "voice",
      event: "ticket_called",
      body: { ar: "تفضل رقم {ticket} إلى {desk}", en: "Now serving {ticket} at {desk}" },
      isActive: true,
    });
    expect((await listTemplates(admin)).filter((t) => t.channel === "voice" && t.event === "ticket_called")).toHaveLength(1);
    let state = await displayState(screen.display);
    expect(state.voice.templates.ticket_called.en).toBe("Now serving {ticket} at {desk}");

    await saveAudioPack(admin, null, {
      locale: "ar",
      name: "Pack",
      manifest: { "ar.digit.1": "/audio/ar/1.mp3", "ar.phrase.number": "/audio/ar/number.mp3" },
      isActive: true,
    });
    expect((await displayState(screen.display)).voice.packs).toEqual({});
    await updateSetting(admin, "voice", { provider: "pack" });
    state = await displayState(screen.display);
    expect(state.voice.packs.ar["ar.digit.1"]).toBe("/audio/ar/1.mp3");
    expect(
      audioPackInput.safeParse({
        locale: "ar",
        name: "Bad",
        manifest: { "ar.digit.1": "https://evil.example/1.mp3" },
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it("bundled Arabic voices can be added and switched from the admin, one active at a time", async () => {
    const screen = await pairedScreen();
    const first = await addBundledVoices(admin);
    expect(first.total).toBeGreaterThanOrEqual(6);
    expect(first.added).toBe(first.total);
    expect((await addBundledVoices(admin)).added).toBe(0); // idempotent

    const packs = await listAudioPacks(admin);
    expect(packs.length).toBe(first.total);
    expect(packs.every((p) => !p.isActive && p.clips >= 60)).toBe(true);

    await expectCode(activateAudioPack(reception, packs[0].id), "forbidden");
    await activateAudioPack(admin, packs[0].id);
    await activateAudioPack(admin, packs[1].id);
    const after = await listAudioPacks(admin);
    expect(after.filter((p) => p.isActive).map((p) => p.id)).toEqual([packs[1].id]);

    // The screen now announces with that voice: provider switched to pre-recorded clips.
    const state = await displayState(screen.display);
    expect(state.voice.settings.provider).toBe("pack");
    expect(state.voice.packs.ar["ar.digit.1"]).toBe(packs[1].manifest["ar.digit.1"]);
    expect(state.voice.packs.ar["ar.letter.أ"]).toBeTruthy();
  });
});
