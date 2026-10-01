import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { branches, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { createDisplay } from "@/server/admin/screens";
import { updateSetting } from "@/server/admin/settings-admin";
import { advanceClock, setClock } from "@/server/clock";
import { authenticateDevice, pairDevice } from "@/server/display/device";
import { displayState } from "@/server/display/state";
import { createHall } from "@/server/halls/admin";
import { callGroup, sessionAction } from "@/server/halls/service";
import { issueTicket } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

type Emitted = { room: string; event: string; payload: Record<string, unknown> };
const emitted: Emitted[] = [];
vi.mock("@/server/realtime", () => ({
  io: () => ({
    to: (room: string) => ({ emit: (event: string, payload: Record<string, unknown>) => emitted.push({ room, event, payload }) }),
  }),
}));

const available = await prepareTestDatabase();
const meta = { ip: "10.0.0.6", userAgent: "vitest-tv-halls" };

describe.runIf(available)("display screens: halls (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  let hallReason: string;
  let hallA: string;
  let hallB: string;

  const issue = async () => {
    const t = await issueTicket(reception, {
      branchId,
      reasonId: hallReason,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    advanceClock(0.1);
    return t.ticket.id;
  };
  const screen = async (zones: string[] = []) => {
    const created = await createDisplay(admin, {
      name: "Lobby TV",
      branchId,
      layout: "classic",
      config: {
        languages: ["ar", "en"],
        rotateSeconds: 15,
        zones,
        showTicker: true,
        showSlides: true,
        showWaiting: true,
        showClock: true,
        showHallOccupancy: true,
        theme: "default",
        voice: {},
      },
    });
    const { token } = await pairDevice(created.pairingCode, meta);
    return authenticateDevice(token);
  };

  beforeEach(async () => {
    emitted.length = 0;
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
    const reasons = await db().select().from(visitReasons);
    hallReason = reasons.find((r) => r.code === "general")!.id;
    await db()
      .update(visitReasons)
      .set({ delivery: "hall", intakeFields: [] })
      .where(inArray(visitReasons.id, [hallReason]));
    hallA = (
      await createHall(admin, branchId, {
        number: "1",
        name: { ar: "القاعة أ", en: "Hall A" },
        capacity: 3,
        zone: "N",
        reasonIds: [],
        sortOrder: 0,
      })
    ).id;
    hallB = (
      await createHall(admin, branchId, {
        number: "2",
        name: { ar: "القاعة ب", en: "Hall B" },
        capacity: 5,
        zone: "S",
        reasonIds: [],
        sortOrder: 1,
      })
    ).id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("shows no halls while the feature is off, and the desks exactly as before", async () => {
    const s = await displayState(await screen());
    expect(s.halls).toEqual([]);
    expect(s.hallsConfig.enabled).toBe(false);
    expect(s.desks.length).toBeGreaterThan(0);
  });

  it("lists the halls free, then called with the group's numbers, then in session, then free again", async () => {
    await updateSetting(admin, "halls", { enabled: true, announceMode: "range", maxAnnounced: 4 });
    const display = await screen();
    let s = await displayState(display);
    expect(s.hallsConfig).toEqual({ enabled: true, announceMode: "range", maxAnnounced: 4 });
    expect(s.halls.map((h) => [h.number, h.status, h.numbers, h.capacity, h.occupied, h.sessionId])).toEqual([
      ["1", "free", [], 3, 0, null],
      ["2", "free", [], 5, 0, null],
    ]);

    const ids = [await issue(), await issue(), await issue()];
    const g = await callGroup(khalid, { hallId: hallA });
    expect(g.session!.tickets.map((t) => t.ticket.id)).toEqual(ids);
    const numbers = g.session!.tickets.map((t) => t.ticket.displayNumber);

    s = await displayState(display);
    const a = s.halls.find((h) => h.id === hallA)!;
    expect(a).toMatchObject({ status: "called", numbers, occupied: 3, capacity: 3, sessionId: g.session!.id });
    expect(s.halls.find((h) => h.id === hallB)!.status).toBe("free");
    // Group calls are in "recent" with the hall number, once each, and hall tickets are not at any desk.
    expect(s.recent.map((r) => [r.displayNumber, r.hallNumber, r.deskNumber])).toEqual(
      expect.arrayContaining(numbers.map((n) => [n, "1", null])),
    );
    expect(s.desks.every((d) => !numbers.includes(d.displayNumber ?? ""))).toBe(true);
    expect(JSON.stringify(s.halls)).not.toMatch(/agent|phone|name":"[^"]*Khalid/i);

    await sessionAction(khalid, g.session!.id, { action: "enter" });
    s = await displayState(display);
    expect(s.halls.find((h) => h.id === hallA)).toMatchObject({ status: "in_session", numbers, occupied: 3 });

    await sessionAction(khalid, g.session!.id, { action: "close", outcome: null });
    s = await displayState(display);
    expect(s.halls.find((h) => h.id === hallA)).toMatchObject({ status: "free", numbers: [], occupied: 0, sessionId: null });
  });

  it("only shows the halls of the screen's zones", async () => {
    await updateSetting(admin, "halls", { enabled: true });
    await issue();
    await callGroup(khalid, { hallId: hallA });
    const north = await displayState(await screen(["N"]));
    expect(north.halls.map((h) => h.number)).toEqual(["1"]);
    expect(north.recent.some((r) => r.hallNumber === "1")).toBe(true);
    const south = await displayState(await screen(["S"]));
    expect(south.halls.map((h) => h.number)).toEqual(["2"]);
    expect(south.recent.some((r) => r.hallNumber === "1")).toBe(false);
  });

  it("publishes hall.called for the group plus ticket.called with the hall on each ticket", async () => {
    await updateSetting(admin, "halls", { enabled: true });
    await issue();
    await issue();
    emitted.length = 0;
    await callGroup(khalid, { hallId: hallB });
    const group = emitted.filter((e) => e.event === "hall.called" && e.room === `screens:${branchId}`);
    expect(group).toHaveLength(1);
    expect(group[0].payload).toMatchObject({ hallId: hallB, hallNumber: "2", recall: false });
    expect(group[0].payload.agentId).toBeUndefined();
    expect((group[0].payload.tickets as unknown[]).length).toBe(2);
    const single = emitted.filter((e) => e.event === "ticket.called" && e.room === `screens:${branchId}`);
    expect(single).toHaveLength(2);
    for (const e of single) expect(e.payload).toMatchObject({ hallId: hallB, hallNumber: "2", deskId: null });
  });
});
