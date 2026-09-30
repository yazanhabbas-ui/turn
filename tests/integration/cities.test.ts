import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, branches, cities, organizations, roles, userRoles, users } from "@/db/schema";
import { syncPermissions } from "@/db/seed/permissions";
import { can, canInCity, citiesFor } from "@/domain/rbac/permissions";
import type { Actor } from "@/server/admin/actor";
import { createBranch, listBranches } from "@/server/admin/branches";
import { archiveCity, createCity, listCities, updateCity } from "@/server/admin/cities";
import { listGroups, saveGroup } from "@/server/admin/groups";
import { createRole } from "@/server/admin/roles";
import { createDisplay, listAnnouncements, listDisplays, saveAnnouncement } from "@/server/admin/screens";
import { listAudit, updateSetting } from "@/server/admin/settings-admin";
import { createUser, forceLogout, issuePasswordReset, listUsers, setUserActive, updateUser } from "@/server/admin/users";
import { AppError } from "@/server/http/errors";
import { buildReport } from "@/server/reports/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("cities, super admin and city admins (database)", () => {
  let superAdmin: Actor;
  let damascusAdmin: Actor;
  let aleppoAdmin: Actor;
  let damascusCity: string;
  let aleppoCity: string;
  let damascusBranch: string;
  let aleppoBranch: string;
  const roleId: Record<string, string> = {};
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(async () => {
    await resetDemo();
    superAdmin = await actorFor("admin@dor.local");
    damascusAdmin = await actorFor("damascus.admin@dor.local");
    aleppoAdmin = await actorFor("aleppo.admin@dor.local");
    const cs = await db().select().from(cities);
    damascusCity = cs.find((c) => c.code === "DAM")!.id;
    aleppoCity = cs.find((c) => c.code === "ALP")!.id;
    const bs = await db().select().from(branches);
    damascusBranch = bs.find((b) => b.code === "DAM-01")!.id;
    aleppoBranch = bs.find((b) => b.code === "ALP-01")!.id;
    for (const r of await db().select().from(roles)) roleId[r.key] = r.id;
  });
  afterAll(async () => {
    await pool().end();
  });

  it("the super admin controls everything; a city admin's grants cover exactly their city's branches", () => {
    const sg = superAdmin.auth.grants;
    expect(can(sg, "cities.manage")).toBe(true);
    expect(citiesFor(sg, "branches.manage")).toBe("all");

    const rg = damascusAdmin.auth.grants;
    expect(can(rg, "branches.manage", damascusBranch)).toBe(true);
    expect(can(rg, "branches.manage", aleppoBranch)).toBe(false);
    expect(canInCity(rg, "branches.manage", damascusCity)).toBe(true);
    expect(canInCity(rg, "branches.manage", aleppoCity)).toBe(false);
    // Organization-level powers are not part of the city admin role.
    for (const p of ["cities.manage", "settings.manage", "roles.manage", "templates.manage"] as const)
      expect(can(rg, p)).toBe(false);
  });

  it("only the super admin manages cities, and a city with branches cannot be archived", async () => {
    await expectCode(createCity(damascusAdmin, { code: "DMM", name: { ar: "الدمام", en: "Dammam" } }), "forbidden");
    const { id } = await createCity(superAdmin, { code: "DMM", name: { ar: "الدمام", en: "Dammam" } });
    await expectCode(createCity(superAdmin, { code: "DMM", name: { ar: "مكرر" } }), "conflict");
    await updateCity(superAdmin, id, { code: "DMM", name: { ar: "الدمام", en: "Dammam East" } });
    await expectCode(archiveCity(superAdmin, aleppoCity), "conflict");
    await archiveCity(superAdmin, id);

    expect((await listCities(superAdmin)).map((c) => c.code).sort()).toEqual(["ALP", "DAM"]);
    expect((await listCities(damascusAdmin)).map((c) => c.code)).toEqual(["DAM"]);
    expect((await listCities(aleppoAdmin)).map((c) => c.code)).toEqual(["ALP"]);
  });

  it("a city admin adds branches to their own city only, and sees only their city's branches", async () => {
    const input = (cityId: string, code: string) => ({
      cityId,
      code,
      name: { ar: "فرع جديد" },
      timezone: "Asia/Damascus",
      weekend: [5, 6],
    });
    await expectCode(createBranch(damascusAdmin, input(aleppoCity, "X-1")), "forbidden");
    const { id } = await createBranch(damascusAdmin, input(damascusCity, "DAM-02"));
    expect((await listBranches(damascusAdmin)).map((b) => b.id)).not.toContain(aleppoBranch);
    expect((await listBranches(aleppoAdmin)).map((b) => b.id)).toEqual([aleppoBranch]);
    // The new branch is covered by the city admin's grant without any change to it.
    const fresh = await actorFor("damascus.admin@dor.local");
    expect(can(fresh.auth.grants, "branches.manage", id)).toBe(true);
    expect((await listBranches(fresh)).map((b) => b.id)).toContain(id);
    // A city admin cannot move a branch into someone else's city, or make it the organization default.
    await expectCode(createBranch(damascusAdmin, input(aleppoCity, "X-2")), "forbidden");
    const created = (await db().select().from(branches).where(eq(branches.id, id)))[0];
    expect(created.isDefault).toBe(false);
  });

  it("a city admin sees and manages only the people of their city", async () => {
    const damascusUsers = (await listUsers(damascusAdmin)).map((u) => u.email);
    expect(damascusUsers).toContain("khalid@dor.local");
    expect(damascusUsers).toContain("damascus.admin@dor.local");
    for (const other of ["faisal@dor.local", "aleppo.admin@dor.local", "admin@dor.local"])
      expect(damascusUsers).not.toContain(other);
    expect((await listUsers(aleppoAdmin)).map((u) => u.email).sort()).toEqual(["aleppo.admin@dor.local", "faisal@dor.local"]);
    expect((await listUsers(superAdmin)).length).toBeGreaterThan(damascusUsers.length);

    const [faisal] = await db().select().from(users).where(eq(users.email, "faisal@dor.local"));
    const [boss] = await db().select().from(users).where(eq(users.email, "admin@dor.local"));
    for (const target of [faisal.id, boss.id]) {
      await expectCode(setUserActive(damascusAdmin, target, false), "forbidden");
      await expectCode(forceLogout(damascusAdmin, target), "forbidden");
      await expectCode(issuePasswordReset(damascusAdmin, target, { sendEmail: false }), "forbidden");
      await expectCode(
        updateUser(damascusAdmin, target, {
          email: "x@dor.local",
          displayName: { ar: "س" },
          grants: [{ roleId: roleId.agent, branchId: damascusBranch, cityId: null }],
        }),
        "forbidden",
      );
    }
    // Their own people are fine.
    const [khalid] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    await setUserActive(damascusAdmin, khalid.id, false);
    await setUserActive(damascusAdmin, khalid.id, true);
  });

  it("a city admin can create people in their city but cannot grant more than they hold or outside their city", async () => {
    const base = { displayName: { ar: "موظف جديد" }, password: "Damascus-Office-77" };
    const { id } = await createUser(damascusAdmin, {
      ...base,
      email: "new.agent@dor.local",
      grants: [{ roleId: roleId.receptionist, branchId: damascusBranch, cityId: null }],
    });
    expect((await listUsers(damascusAdmin)).map((u) => u.id)).toContain(id);

    // A second city admin for the same city is allowed (a city-scoped grant).
    await createUser(damascusAdmin, {
      ...base,
      email: "second.admin@dor.local",
      grants: [{ roleId: roleId.admin, branchId: null, cityId: damascusCity }],
    });

    const grant = (g: { roleId: string; branchId?: string | null; cityId?: string | null }) => ({
      branchId: null,
      cityId: null,
      ...g,
    });
    const attempts: [string, ReturnType<typeof grant>][] = [
      ["another city's branch", grant({ roleId: roleId.agent, branchId: aleppoBranch })],
      ["another city", grant({ roleId: roleId.admin, cityId: aleppoCity })],
      ["the whole organization", grant({ roleId: roleId.receptionist })],
      ["super admin", grant({ roleId: roleId.super_admin, cityId: damascusCity })],
    ];
    for (const [label, g] of attempts) {
      await expectCode(createUser(damascusAdmin, { ...base, email: `x${label.length}@dor.local`, grants: [g] }), "forbidden");
    }
    // Someone limited to a scope must place the new user inside it.
    await expectCode(createUser(damascusAdmin, { ...base, email: "nowhere@dor.local", grants: [] }), "validation");
    // Only the super admin can create city admins for any city and other super admins.
    await createUser(superAdmin, {
      ...base,
      email: "boss2@dor.local",
      grants: [{ roleId: roleId.super_admin, branchId: null, cityId: null }],
    });
  });

  it("city admins cannot change organization-level things", async () => {
    await expectCode(
      createRole(damascusAdmin, { key: "x", name: { ar: "دور" }, permissions: ["tickets.view"] } as never),
      "forbidden",
    );
    await expectCode(updateSetting(damascusAdmin, "branding", { primaryColor: "#000000" }), "forbidden");
    // ...but may set their own branches' Wi-Fi, not another city's.
    await updateSetting(damascusAdmin, "wifi", { enabled: true, ssid: "DAM", password: "" }, damascusBranch);
    await expectCode(
      updateSetting(damascusAdmin, "wifi", { enabled: true, ssid: "ALP", password: "" }, aleppoBranch),
      "forbidden",
    );
    await expectCode(updateSetting(damascusAdmin, "wifi", { enabled: true, ssid: "ORG", password: "" }), "forbidden");
    await updateSetting(superAdmin, "wifi", { enabled: true, ssid: "ORG", password: "" });
  });

  it("screens, announcements and groups are limited to the admin's own branches", async () => {
    await createDisplay(damascusAdmin, { name: "DAM TV", branchId: damascusBranch, layout: "classic", config: {} as never });
    await expectCode(
      createDisplay(damascusAdmin, { name: "ALP TV", branchId: aleppoBranch, layout: "classic", config: {} as never }),
      "forbidden",
    );
    await createDisplay(aleppoAdmin, { name: "ALP TV", branchId: aleppoBranch, layout: "classic", config: {} as never });
    expect((await listDisplays(damascusAdmin)).map((d) => d.name)).not.toContain("ALP TV");
    expect((await listDisplays(superAdmin)).map((d) => d.name)).toEqual(expect.arrayContaining(["DAM TV", "ALP TV"]));

    const ann = (branchId: string | null) => ({
      kind: "ticker" as const,
      body: { ar: "إعلان" },
      durationSeconds: 10,
      sortOrder: 0,
      isActive: true,
      branchId,
    });
    await expectCode(saveAnnouncement(damascusAdmin, null, ann(null)), "forbidden");
    await expectCode(saveAnnouncement(damascusAdmin, null, ann(aleppoBranch)), "forbidden");
    await saveAnnouncement(damascusAdmin, null, ann(damascusBranch));
    await saveAnnouncement(aleppoAdmin, null, ann(aleppoBranch));
    await saveAnnouncement(superAdmin, null, ann(null));
    expect((await listAnnouncements(damascusAdmin)).every((a) => a.branchId === damascusBranch)).toBe(true);
    expect((await listAnnouncements(superAdmin)).length).toBeGreaterThan((await listAnnouncements(damascusAdmin)).length);

    expect((await listGroups(aleppoAdmin)).length).toBe(0);
    expect((await listGroups(damascusAdmin)).length).toBeGreaterThan(0);
    await expectCode(saveGroup(damascusAdmin, null, { name: { ar: "مجموعة" }, branchId: null, memberIds: [] }), "forbidden");
    await expectCode(
      saveGroup(damascusAdmin, null, { name: { ar: "مجموعة" }, branchId: aleppoBranch, memberIds: [] }),
      "forbidden",
    );
  });

  it("reports and the audit trail are limited to the admin's cities", async () => {
    const filters = { from: today, to: today };
    await buildReport(damascusAdmin, { ...filters, branchId: damascusBranch });
    await expectCode(buildReport(damascusAdmin, { ...filters, branchId: aleppoBranch }), "forbidden");
    const all = await buildReport(superAdmin, filters);
    expect(all.data.byBranch).toBeDefined();

    await db()
      .insert(auditLogs)
      .values([
        {
          organizationId: (await db().select().from(organizations))[0].id,
          branchId: aleppoBranch,
          action: "test.aleppo",
          entityType: "test",
        },
        {
          organizationId: (await db().select().from(organizations))[0].id,
          branchId: damascusBranch,
          action: "test.damascus",
          entityType: "test",
        },
      ]);
    const seen = (await listAudit(damascusAdmin, { entityType: "test" })).items.map((r) => r.action);
    expect(seen).toEqual(["test.damascus"]);
    expect((await listAudit(superAdmin, { entityType: "test" })).items.length).toBe(2);
  });

  it("existing organization-wide admins become super admins when upgrading, and nobody loses access", async () => {
    const [org] = await db().select().from(organizations);
    // Simulate an installation from before cities: no super admin role, an organization-wide admin.
    const [old] = await db().select().from(users).where(eq(users.email, "reception@dor.local"));
    await db().delete(userRoles).where(eq(userRoles.roleId, roleId.super_admin));
    await db().delete(roles).where(eq(roles.id, roleId.super_admin));
    await db().insert(userRoles).values({ userId: old.id, roleId: roleId.admin });
    await db().transaction((tx) => syncPermissions(tx, org.id));

    const [superRole] = await db()
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, org.id), eq(roles.key, "super_admin")));
    const grants = await db().select().from(userRoles).where(eq(userRoles.userId, old.id));
    expect(grants.some((g) => g.roleId === superRole.id && g.branchId === null && g.cityId === null)).toBe(true);
    expect(grants.some((g) => g.roleId === roleId.admin && g.branchId === null && g.cityId === null)).toBe(false);
    // Running the sync again changes nothing.
    await db().transaction((tx) => syncPermissions(tx, org.id));
    expect((await db().select().from(userRoles).where(eq(userRoles.userId, old.id))).length).toBe(grants.length);
  });
});
