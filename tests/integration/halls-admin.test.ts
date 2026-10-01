import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { agentProfiles, branches, halls, hallSessions, tickets, visitReasons } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { createFloor, listBranches } from "@/server/admin/branches";
import { updateReason } from "@/server/admin/reasons";
import { listUsers, updateUser } from "@/server/admin/users";
import { archiveHall, createHall, updateHall } from "@/server/halls/admin";
import { AppError } from "@/server/http/errors";
import { issueTicket } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, detail?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) =>
      e instanceof AppError && e.code === code && (!detail || e.details?.field === detail || e.details?.reason === detail),
  );
}

const hallBody = (over: Record<string, unknown> = {}) => ({
  number: "1",
  name: { ar: "قاعة الاجتماعات", en: "Meeting hall" },
  capacity: 10,
  reasonIds: [] as string[],
  sortOrder: 0,
  ...over,
});

describe.runIf(available)("halls: administration (database)", () => {
  let admin: Actor;
  let damascusAdmin: Actor;
  let aleppoAdmin: Actor;
  let reception: Actor;
  let khalid: Actor;
  let damascusBranch: string;
  let aleppoBranch: string;
  let hallReason: string;
  let deskReason: string;

  const reasonBody = async (id: string, over: Record<string, unknown> = {}) => {
    const [r] = await db().select().from(visitReasons).where(eq(visitReasons.id, id));
    return {
      code: r.code,
      name: r.name,
      icon: r.icon,
      color: r.color,
      prefix: r.prefix,
      defaultPriorityKey: r.defaultPriorityKey,
      expectedServiceMinutes: r.expectedServiceMinutes,
      slaTargetWaitMinutes: r.slaTargetWaitMinutes,
      intakeFields: [],
      allowAppointments: r.allowAppointments,
      isFeatured: r.isFeatured,
      shortcutKey: r.shortcutKey,
      sortOrder: r.sortOrder,
      ...over,
    };
  };

  beforeEach(async () => {
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    damascusAdmin = await actorFor("damascus.admin@dor.local");
    aleppoAdmin = await actorFor("aleppo.admin@dor.local");
    reception = await actorFor("reception@dor.local");
    khalid = await actorFor("khalid@dor.local");
    const bs = await db().select().from(branches);
    damascusBranch = bs.find((b) => b.code === "DAM-01")!.id;
    aleppoBranch = bs.find((b) => b.code === "ALP-01")!.id;
    const rs = await db().select().from(visitReasons);
    hallReason = rs.find((r) => r.code === "general")!.id;
    deskReason = rs.find((r) => r.code === "contract")!.id;
    await updateReason(admin, hallReason, (await reasonBody(hallReason, { delivery: "hall" })) as never);
  });
  afterAll(async () => {
    await pool().end();
  });

  it("creates, updates and lists halls with their accepted reasons", async () => {
    const { id } = await createHall(admin, damascusBranch, hallBody({ reasonIds: [hallReason] }));
    let listed = (await listBranches(admin)).find((b) => b.id === damascusBranch)!;
    expect(listed.halls).toHaveLength(1);
    expect(listed.halls[0]).toMatchObject({ id, number: "1", capacity: 10, reasonIds: [hallReason] });
    await updateHall(admin, id, hallBody({ capacity: 25, zone: "B", reasonIds: [] }));
    listed = (await listBranches(admin)).find((b) => b.id === damascusBranch)!;
    expect(listed.halls[0]).toMatchObject({ capacity: 25, zone: "B", reasonIds: [] });
    // A city admin sees only their own city's halls.
    expect((await listBranches(damascusAdmin)).every((b) => b.id !== aleppoBranch)).toBe(true);
  });

  it("scopes by city: a Damascus admin cannot touch an Aleppo hall, the super admin can", async () => {
    await expectCode(createHall(damascusAdmin, aleppoBranch, hallBody()), "forbidden");
    const { id } = await createHall(admin, aleppoBranch, hallBody());
    await expectCode(updateHall(damascusAdmin, id, hallBody({ capacity: 4 })), "forbidden");
    await expectCode(archiveHall(damascusAdmin, id), "forbidden");
    await updateHall(aleppoAdmin, id, hallBody({ capacity: 4 }));
    // Own city works.
    const own = await createHall(damascusAdmin, damascusBranch, hallBody());
    await archiveHall(damascusAdmin, own.id);
    await archiveHall(admin, id);
  });

  it("refuses receptionists and agents", async () => {
    await expectCode(createHall(reception, damascusBranch, hallBody()), "forbidden");
    await expectCode(createHall(khalid, damascusBranch, hallBody()), "forbidden");
    const { id } = await createHall(admin, damascusBranch, hallBody());
    await expectCode(updateHall(khalid, id, hallBody()), "forbidden");
    await expectCode(archiveHall(reception, id), "forbidden");
  });

  it("keeps the number unique per branch, and archived numbers can be reused", async () => {
    const { id } = await createHall(admin, damascusBranch, hallBody());
    await expectCode(createHall(admin, damascusBranch, hallBody()), "conflict", "number");
    // The same number in another branch is fine.
    await createHall(admin, aleppoBranch, hallBody());
    const b = await createHall(admin, damascusBranch, hallBody({ number: "2" }));
    await expectCode(updateHall(admin, b.id, hallBody({ number: "1" })), "conflict", "number");
    await archiveHall(admin, id);
    await createHall(admin, damascusBranch, hallBody());
  });

  it("validates capacity, reasons and floor", async () => {
    const { hallInput } = await import("@/server/halls/admin");
    expect(hallInput.safeParse(hallBody({ capacity: 1 })).success).toBe(false);
    expect(hallInput.safeParse(hallBody({ capacity: 2 })).success).toBe(true);
    expect(hallInput.safeParse(hallBody({ capacity: 501 })).success).toBe(false);
    // Only hall-delivery reasons of the organization are accepted.
    await expectCode(createHall(admin, damascusBranch, hallBody({ reasonIds: [deskReason] })), "validation", "reasonIds");
    // A floor of another branch is refused.
    const { id: otherFloor } = await createFloor(admin, aleppoBranch, { name: { ar: "الأول", en: "First" }, sortOrder: 0 });
    await expectCode(createHall(admin, damascusBranch, hallBody({ floorId: otherFloor })), "validation", "floorId");
    const { id: floor } = await createFloor(admin, damascusBranch, { name: { ar: "الأول", en: "First" }, sortOrder: 0 });
    const { id } = await createHall(admin, damascusBranch, hallBody({ floorId: floor }));
    const [h] = await db().select().from(halls).where(eq(halls.id, id));
    expect(h.floorId).toBe(floor);
  });

  it("switching a reason to hall delivery sends waiting reserved visitors back to the shared line", async () => {
    const reasonId = deskReason;
    await db().update(visitReasons).set({ intakeFields: [] }).where(eq(visitReasons.id, reasonId));
    const issued = await issueTicket(reception, {
      branchId: damascusBranch,
      reasonId,
      language: "ar",
      fields: {},
      consent: false,
      source: "reception",
    });
    const ticketId = issued.ticket.id;
    // Reserve the waiting ticket for an agent, then make the reason a hall reason.
    await db()
      .update(tickets)
      .set({ assignedAgentId: khalid.auth.user.id, assignedAt: new Date() })
      .where(eq(tickets.id, ticketId));
    await updateReason(admin, reasonId, (await reasonBody(reasonId, { delivery: "hall" })) as never);
    const [after] = await db().select().from(tickets).where(eq(tickets.id, ticketId));
    expect(after.assignedAgentId).toBeNull();
    expect(after.assignedAt).toBeNull();
    const [r] = await db().select().from(visitReasons).where(eq(visitReasons.id, reasonId));
    expect(r.delivery).toBe("hall");
  });

  it("a user's default hall must belong to the agent's branch", async () => {
    const own = await createHall(admin, damascusBranch, hallBody());
    const foreign = await createHall(admin, aleppoBranch, hallBody());
    const [row] = (await listUsers(admin, { q: "khalid@dor.local" }))!;
    const [profile] = await db().select().from(agentProfiles).where(eq(agentProfiles.userId, row.id));
    const input = (defaultHallId: string | null) => ({
      email: row.email,
      displayName: row.displayName,
      grants: row.grants.map((g) => ({ roleId: g.roleId, branchId: g.branchId, cityId: g.cityId ?? null })),
      agent: { branchId: profile.branchId, defaultHallId, maxConcurrent: null, shiftId: null, weight: 1 },
    });
    await expectCode(updateUser(admin, row.id, input(foreign.id)), "validation", "agent.defaultHallId");
    await updateUser(admin, row.id, input(own.id));
    expect((await listUsers(admin, { q: "khalid@dor.local" }))[0].agent?.defaultHallId).toBe(own.id);
    // Archiving the hall clears the default.
    await archiveHall(admin, own.id);
    expect((await listUsers(admin, { q: "khalid@dor.local" }))[0].agent?.defaultHallId).toBeNull();
  });

  it("refuses to archive a hall with a live session, or to shrink it below the session", async () => {
    const { id } = await createHall(admin, damascusBranch, hallBody({ capacity: 6 }));
    const [b] = await db().select().from(branches).where(eq(branches.id, damascusBranch));
    await db().insert(hallSessions).values({
      organizationId: b.organizationId,
      branchId: damascusBranch,
      hallId: id,
      hostAgentId: khalid.auth.user.id,
      status: "OPEN",
      capacity: 6,
    });
    await expectCode(archiveHall(admin, id), "conflict", "hall_session_open");
    await expectCode(updateHall(admin, id, hallBody({ capacity: 3 })), "conflict", "hall_session_open");
    await updateHall(admin, id, hallBody({ capacity: 8 }));
    await db().update(hallSessions).set({ status: "CLOSED", closedAt: new Date() }).where(eq(hallSessions.hallId, id));
    await archiveHall(admin, id);
    expect(
      await db()
        .select()
        .from(halls)
        .where(and(eq(halls.id, id), isNull(halls.archivedAt))),
    ).toHaveLength(0);
    expect((await listBranches(admin)).find((x) => x.id === damascusBranch)!.halls).toHaveLength(0);
  });
});
