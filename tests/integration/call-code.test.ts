import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { authenticateDevice, pairDevice } from "@/server/display/device";
import { displayState } from "@/server/display/state";
import { branches, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { createDisplay } from "@/server/admin/screens";
import { updateSetting } from "@/server/admin/settings-admin";
import { setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { publicTicketStatus } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectReason(p: Promise<unknown>, code: string, reason: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && e.details?.reason === reason);
}

describe.runIf(available)("calling by phone digits and restarting numbers (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

  const issue = (code: string, extra: Record<string, unknown> = {}) =>
    issueTicket(reception, {
      branchId,
      reasonId: reason[code],
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
      ...extra,
    });

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
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

  describe("numbers restart after a limit", () => {
    it("goes back to 1 after the limit, skipping numbers still held by waiting visitors", async () => {
      await updateSetting(admin, "ticketing", { numberResetAfter: 3 });
      const numbers: string[] = [];
      for (let i = 0; i < 3; i++) numbers.push((await issue("general")).ticket.displayNumber);
      expect(numbers.map((n) => n.slice(-3))).toEqual(["001", "002", "003"]);

      // One visitor is served and gone: the next ticket starts over at the number that became free; the other two
      // numbers are still held by waiting visitors and are not handed out again.
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const called = await callNext(khalid);
      const freed = called.ticket!.displayNumber;
      expect(numbers).toContain(freed);
      await ticketAction(khalid, called.ticket!.id, { action: "start" });
      await ticketAction(khalid, called.ticket!.id, { action: "complete" });
      const fourth = (await issue("general")).ticket.displayNumber;
      expect(fourth).toBe(freed);

      // Every number up to the limit is held by a waiting visitor now: no duplicates are ever handed out.
      await expectReason(issue("general"), "conflict", "range_exhausted");
    });

    it("keeps counting up when the limit is off", async () => {
      await updateSetting(admin, "ticketing", { numberResetAfter: 0 });
      const list: string[] = [];
      for (let i = 0; i < 5; i++) list.push((await issue("general")).ticket.displayNumber.slice(-3));
      expect(list).toEqual(["001", "002", "003", "004", "005"]);
    });
  });

  describe("call code", () => {
    it("is off by default: nothing is required and nothing is stored", async () => {
      const t = (await issue("general", { callPhone: "0501234567" })).ticket;
      expect(t.callCode).toBeNull();
    });

    it("needs the phone from reception when on, keeps only the last digits, and the screens show them", async () => {
      await updateSetting(admin, "ticketing", { callByPhone: true, callByPhoneDigits: 3 });
      await expectReason(issue("general"), "validation", "call_code_required");
      await expectReason(issue("general", { callPhone: "12" }), "validation", "call_code_required");

      const issued = (await issue("general", { callPhone: "+963 944 123 472" })).ticket;
      expect(issued.callCode).toBe("472");
      // The visitor's own page says which digits to listen for, and carries the organization's look.
      const page = await publicTicketStatus(issued.publicToken);
      expect(page?.callCode).toBe("472");
      expect(page?.branding.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      // Eastern Arabic digits work too.
      const second = (await issue("general", { callPhone: "٠٥٠١٢٣٤٥٩٣٨" })).ticket;
      expect(second.callCode).toBe("938");

      // Nobody else in the line may end in the same digits.
      await expectReason(issue("general", { callPhone: "0911111472" }), "conflict", "call_code_in_use");

      // A screen shows the digits instead of the ticket number once the visitor is called.
      const created = await createDisplay(admin, {
        name: "Lobby",
        branchId,
        layout: "classic",
        config: {
          languages: ["ar", "en"],
          rotateSeconds: 15,
          zones: [],
          showTicker: true,
          showSlides: true,
          showWaiting: true,
          showClock: true,
          showHallOccupancy: true,
          theme: "default",
          voice: {},
        },
      });
      const { token } = await pairDevice(created.pairingCode, { ip: "10.0.0.5", userAgent: "vitest-tv" });
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const called = await callNext(khalid);
      expect([issued.id, second.id]).toContain(called.ticket?.id);
      const state = await displayState(await authenticateDevice(token));
      expect(state.recent[0]).toMatchObject({ displayNumber: called.ticket!.callCode, byPhone: true });
      expect(["472", "938"]).toContain(state.recent[0].displayNumber);
    });

    it("frees the digits once the visit is finished", async () => {
      await updateSetting(admin, "ticketing", { callByPhone: true });
      const t = (await issue("general", { callPhone: "0500000123" })).ticket;
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const called = await callNext(khalid);
      await ticketAction(khalid, called.ticket!.id, { action: "start" });
      await ticketAction(khalid, called.ticket!.id, { action: "complete" });
      expect(called.ticket!.id).toBe(t.id);
      expect((await issue("general", { callPhone: "0599999123" })).ticket.callCode).toBe("123");
    });

    it("does not require the phone for tickets that do not come from the reception desk", async () => {
      await updateSetting(admin, "ticketing", { callByPhone: true });
      const kiosk = (await issue("general", { source: "kiosk" })).ticket;
      expect(kiosk.callCode).toBeNull();
    });
  });
});
