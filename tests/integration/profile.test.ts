import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, branches, userAvatars, users, visitReasons } from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { advanceClock, setClock } from "@/server/clock";
import { AppError } from "@/server/http/errors";
import { callNext, issueTicket, setAgentStatus, ticketAction } from "@/server/queue/tickets";
import { activityQuery, myActivity } from "@/server/profile/activity";
import { AVATAR_MAX_BYTES, loadAvatar, removeAvatar, setOwnAvatar } from "@/server/profile/avatar";
import { myProfile } from "@/server/profile/profile";
import { myProgress } from "@/server/profile/progress";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason),
  );
}

const picture = (format: "png" | "jpeg" | "webp" | "gif" = "png", w = 600, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    [format]()
    .toBuffer();

describe.runIf(available)("user profiles (database)", () => {
  let admin: Actor;
  let cityAdmin: Actor;
  let reception: Actor;
  let supervisor: Actor;
  let khalid: Actor;
  let noura: Actor;
  let branchId: string;
  const reason: Record<string, string> = {};

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    cityAdmin = await actorFor("damascus.admin@dor.local");
    reception = await actorFor("reception@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    khalid = await actorFor("khalid@dor.local");
    noura = await actorFor("noura@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches).limit(1);
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  describe("profile picture", () => {
    it("accepts a png, stores a 256x256 webp without metadata, and bumps the version on replace", async () => {
      const first = await setOwnAvatar(khalid, await picture("png"));
      expect(first.avatarVersion).toBe(1);
      const stored = await loadAvatar(khalid, khalid.auth.user.id);
      expect(stored?.contentType).toBe("image/webp");
      const meta = await sharp(stored!.data).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
      expect(meta.exif).toBeUndefined();

      const second = await setOwnAvatar(khalid, await picture("jpeg", 300, 900));
      expect(second.avatarVersion).toBe(2);
      const replaced = await loadAvatar(khalid, khalid.auth.user.id);
      expect(replaced!.etag).not.toBe(stored!.etag);
      expect(await db().select().from(userAvatars)).toHaveLength(1);
      const [u] = await db().select().from(users).where(eq(users.id, khalid.auth.user.id));
      expect(u.avatarVersion).toBe(2);
      const refreshed = await actorFor("khalid@dor.local");
      expect(refreshed.auth.user.avatarVersion).toBe(2);
      expect((await myProfile(khalid)).avatarVersion).toBe(2);
    });

    it("also accepts jpeg and webp, and applies the EXIF orientation while dropping the metadata", async () => {
      await setOwnAvatar(khalid, await picture("jpeg"));
      await setOwnAvatar(khalid, await picture("webp"));
      const tagged = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#123456" } })
        .jpeg()
        .withExif({ IFD0: { Copyright: "secret", Orientation: "6" } })
        .toBuffer();
      await setOwnAvatar(khalid, tagged);
      const out = await sharp((await loadAvatar(khalid, khalid.auth.user.id))!.data).metadata();
      expect(out.exif).toBeUndefined();
      expect(out.width).toBe(256);
    });

    it("rejects files that are not images, other image types, empty and oversize uploads", async () => {
      await expectCode(
        setOwnAvatar(khalid, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")),
        "validation",
        "unsupported_type",
      );
      await expectCode(
        setOwnAvatar(khalid, Buffer.from("just some text pretending to be a.png")),
        "validation",
        "unsupported_type",
      );
      await expectCode(setOwnAvatar(khalid, await picture("gif")), "validation", "unsupported_type");
      await expectCode(setOwnAvatar(khalid, Buffer.alloc(0)), "validation", "empty");
      await expectCode(setOwnAvatar(khalid, Buffer.alloc(AVATAR_MAX_BYTES + 1, 1)), "validation", "too_large");
      expect(await db().select().from(userAvatars)).toHaveLength(0);
    });

    it("lets a user delete their own picture, and records both changes in the audit trail", async () => {
      await setOwnAvatar(khalid, await picture());
      await removeAvatar(khalid, khalid.auth.user.id);
      expect(await loadAvatar(khalid, khalid.auth.user.id)).toBeNull();
      const [u] = await db().select().from(users).where(eq(users.id, khalid.auth.user.id));
      expect(u.avatarVersion).toBeNull();
      const actions = (await db().select().from(auditLogs).where(eq(auditLogs.actorUserId, khalid.auth.user.id))).map(
        (a) => a.action,
      );
      expect(actions).toEqual(expect.arrayContaining(["user.avatar_set", "user.avatar_removed"]));
    });

    it("keeps other people out: only users.manage (within scope) may remove someone else's picture", async () => {
      await setOwnAvatar(khalid, await picture());
      await expectCode(removeAvatar(noura, khalid.auth.user.id), "forbidden");
      await expectCode(removeAvatar(reception, khalid.auth.user.id), "forbidden");
      expect(await loadAvatar(khalid, khalid.auth.user.id)).not.toBeNull();
      await removeAvatar(cityAdmin, khalid.auth.user.id);
      expect(await loadAvatar(khalid, khalid.auth.user.id)).toBeNull();
      await setOwnAvatar(khalid, await picture());
      await removeAvatar(admin, khalid.auth.user.id);
      expect(await loadAvatar(khalid, khalid.auth.user.id)).toBeNull();
    });

    it("has no way to set someone else's picture: the upload always applies to the signed-in user", async () => {
      await setOwnAvatar(admin, await picture());
      expect(await loadAvatar(khalid, khalid.auth.user.id)).toBeNull();
      expect(await loadAvatar(khalid, admin.auth.user.id)).not.toBeNull(); // visible to colleagues of the organization
    });
  });

  describe("my activity", () => {
    it("returns only the signed-in user's own rows (non-agent), filtered by type and paginated", async () => {
      await setOwnAvatar(admin, await picture());
      await setOwnAvatar(admin, await picture());
      await setOwnAvatar(cityAdmin, await picture());
      const mine = await myActivity(admin, activityQuery.parse({ type: "audit" }));
      expect(mine.items).toHaveLength(2);
      expect(
        mine.items.every((i) => i.kind === "audit" && i.action === "user.avatar_set" && i.entityId === admin.auth.user.id),
      ).toBe(true);

      const page1 = await myActivity(admin, activityQuery.parse({ type: "audit", limit: 1 }));
      expect(page1.items).toHaveLength(1);
      expect(page1.nextBefore).not.toBeNull();
      const page2 = await myActivity(admin, activityQuery.parse({ type: "audit", limit: 1, before: page1.nextBefore! }));
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
      expect(page2.nextBefore).toBeNull();

      // Nothing of anyone else's shows up for a supervisor with no activity of their own.
      expect((await myActivity(supervisor, activityQuery.parse({}))).items).toEqual([]);
    });

    it("lists served tickets with reason, outcome and durations, and issued tickets for reception, within the day range", async () => {
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      const t = await issueTicket(reception, {
        branchId,
        reasonId: reason.general,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      });
      advanceClock(4);
      await callNext(khalid);
      advanceClock(1);
      await ticketAction(khalid, t.ticket.id, { action: "start" });
      advanceClock(6);
      await ticketAction(khalid, t.ticket.id, { action: "complete", outcome: "resolved" });

      const served = await myActivity(khalid, activityQuery.parse({ type: "tickets" }));
      expect(served.items).toHaveLength(1);
      expect(served.items[0]).toMatchObject({
        kind: "ticket",
        role: "served",
        displayNumber: t.ticket.displayNumber,
        status: "COMPLETED",
        outcome: "resolved",
        serviceMin: 6,
        waitMin: 4,
      });

      const issued = await myActivity(reception, activityQuery.parse({ type: "tickets" }));
      expect(issued.items).toHaveLength(1);
      expect(issued.items[0]).toMatchObject({ role: "issued", displayNumber: t.ticket.displayNumber });

      expect((await myActivity(noura, activityQuery.parse({ type: "tickets" }))).items).toEqual([]);

      advanceClock(60 * 24 * 40);
      expect((await myActivity(khalid, activityQuery.parse({ type: "tickets", days: 30 }))).items).toEqual([]);
      expect((await myActivity(khalid, activityQuery.parse({ type: "tickets", days: 90 }))).items).toHaveLength(1);
    });
  });

  describe("my progress", () => {
    async function serve(agent: Actor, wait: number, service: number) {
      const t = await issueTicket(reception, {
        branchId,
        reasonId: reason.general,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      });
      advanceClock(wait);
      await callNext(agent);
      await ticketAction(agent, t.ticket.id, { action: "start" });
      advanceClock(service);
      await ticketAction(agent, t.ticket.id, { action: "complete", outcome: "resolved" });
    }

    it("counts what an agent served today, with times, comparison, branch average and milestones", async () => {
      // Yesterday: one visitor for Khalid.
      setClock(zonedToUtc("2026-09-28", "10:00", "Asia/Damascus"));
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      await serve(khalid, 3, 5);
      // Today: three for Khalid, one for Noura.
      setClock(zonedToUtc("2026-09-29", "09:00", "Asia/Damascus"));
      await setAgentStatus(noura, { status: "AVAILABLE" });
      await serve(khalid, 4, 6);
      await serve(khalid, 4, 6);
      await serve(khalid, 4, 6);
      await serve(noura, 8, 10);
      setClock(zonedToUtc("2026-09-29", "12:00", "Asia/Damascus"));

      const p = await myProgress(khalid, "week");
      expect(p.timezone).toBe("Asia/Damascus");
      const agent = p.agent!;
      expect(agent.periods.day.current).toMatchObject({
        served: 3,
        noShows: 0,
        avgServiceMin: 6,
        avgWaitMin: 4,
        resolvedPct: 100,
      });
      expect(agent.periods.day.previous.served).toBe(1);
      expect(agent.periods.day.change.served.changePct).toBe(200);
      expect(agent.periods.day.branch?.servedPerAgent).toBe(2); // 4 visitors by 2 agents
      expect(agent.periods.day.current.availableMin).toBeGreaterThan(0);
      expect(agent.periods.week.current.served).toBe(4);
      expect(agent.trend).toHaveLength(14);
      expect(agent.trend.at(-1)).toEqual({ date: "2026-09-29", served: 3 });
      expect(agent.trend.at(-2)).toEqual({ date: "2026-09-28", served: 1 });
      expect(agent.milestones).toMatchObject({
        totalServed: 4,
        activeDays: 2,
        streakDays: 2,
        bestDay: { date: "2026-09-29", served: 3 },
      });
      expect(p.issued).toBeNull();

      // Noura's numbers are her own.
      expect((await myProgress(noura, "day")).agent!.periods.day.current).toMatchObject({
        served: 1,
        avgWaitMin: 8,
        avgServiceMin: 10,
      });
      expect((await myProgress(noura, "month")).agent!.trend).toHaveLength(30);
    });

    it("shows tickets issued for a receptionist and audited actions for everyone, and no agent block for non-agents", async () => {
      setClock(null); // audit rows are stamped with the database clock
      await setAgentStatus(khalid, { status: "AVAILABLE" });
      await serve(khalid, 1, 1);
      await setOwnAvatar(reception, await picture());
      const r = await myProgress(reception, "week");
      expect(r.agent).toBeNull();
      expect(r.issued?.periods.day.current).toBe(1);
      expect(r.actions.periods.day.current).toBe(1);
      const s = await myProgress(supervisor, "week");
      expect(s.issued).toBeNull();
      expect(s.actions.periods.week.current).toBe(0);
    });
  });
});
