import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, branches, cities, shifts, visitReasons } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { createBranch } from "@/server/admin/branches";
import { listCityReasons, setCityReason } from "@/server/admin/city-reasons";
import { deleteCityTemplate, listTemplates, saveTemplate } from "@/server/admin/screens";
import {
  clearSettingOverride,
  copyCityConfiguration,
  listAudit,
  listCityOverrides,
  readAllSettings,
  readSettingSources,
  updateSetting,
} from "@/server/admin/settings-admin";
import { createShift, listShifts } from "@/server/admin/shifts";
import { AppError } from "@/server/http/errors";
import { templateFor } from "@/server/notifications/deliver";
import { issueTicket } from "@/server/queue/tickets";
import { receptionContext } from "@/server/queue/views";
import { getSetting, getSettingSource } from "@/server/settings/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

// Records the screen refreshes the server asks for.
const emitted: string[] = [];
vi.mock("@/server/realtime", () => ({
  io: () => ({ to: (room: string) => ({ emit: (event: string) => emitted.push(`${room}:${event}`) }) }),
}));

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

const wifi = (ssid: string, enabled = true) => ({ enabled, ssid, password: "", showQr: false });

describe.runIf(available)("configuration per city (database)", () => {
  let superAdmin: Actor;
  let damAdmin: Actor;
  let alpAdmin: Actor;
  let reception: Actor;
  let org: string;
  let damCity: string;
  let alpCity: string;
  let damBranch: string;
  let alpBranch: string;

  beforeEach(async () => {
    emitted.length = 0;
    await resetDemo();
    superAdmin = await actorFor("admin@dor.local");
    damAdmin = await actorFor("damascus.admin@dor.local");
    alpAdmin = await actorFor("aleppo.admin@dor.local");
    reception = await actorFor("reception@dor.local");
    org = superAdmin.auth.user.organizationId;
    const cs = await db().select().from(cities);
    damCity = cs.find((c) => c.code === "DAM")!.id;
    alpCity = cs.find((c) => c.code === "ALP")!.id;
    const bs = await db().select().from(branches);
    damBranch = bs.find((b) => b.code === "DAM-01")!.id;
    alpBranch = bs.find((b) => b.code === "ALP-01")!.id;
  });
  afterAll(async () => {
    await pool().end();
  });

  it("resolves organization ← city ← branch and reports where the value comes from", async () => {
    await updateSetting(superAdmin, "wifi", wifi("Org-Guest"));
    expect((await getSettingSource(org, "wifi", { branchId: damBranch })).source.level).toBe("organization");

    await updateSetting(damAdmin, "wifi", wifi("Damascus-Guest"), null, damCity);
    expect(await getSetting(org, "wifi", damBranch)).toMatchObject({ ssid: "Damascus-Guest" });
    expect(await getSetting(org, "wifi", alpBranch)).toMatchObject({ ssid: "Org-Guest" }); // other city untouched
    expect(await getSetting(org, "wifi")).toMatchObject({ ssid: "Org-Guest" });
    expect(await getSettingSource(org, "wifi", { branchId: damBranch })).toMatchObject({
      source: { level: "city", cityId: damCity, branchId: null },
    });
    expect((await getSettingSource(org, "wifi", { cityId: damCity })).source.level).toBe("city");

    await updateSetting(damAdmin, "wifi", wifi("Branch-Guest"), damBranch);
    expect(await getSetting(org, "wifi", damBranch)).toMatchObject({ ssid: "Branch-Guest" });
    expect(await getSettingSource(org, "wifi", { branchId: damBranch })).toMatchObject({
      source: { level: "branch", cityId: damCity, branchId: damBranch },
    });

    // Removing the branch value falls back to the city, removing the city value to the organization.
    await clearSettingOverride(damAdmin, "wifi", damBranch);
    expect(await getSetting(org, "wifi", damBranch)).toMatchObject({ ssid: "Damascus-Guest" });
    await clearSettingOverride(damAdmin, "wifi", null, damCity);
    expect(await getSetting(org, "wifi", damBranch)).toMatchObject({ ssid: "Org-Guest" });
    expect((await getSettingSource(org, "wifi", { branchId: damBranch })).source.level).toBe("organization");

    // The reception console (a real consumer) sees the city value too.
    await updateSetting(damAdmin, "wifi", wifi("Reception-City"), null, damCity);
    expect((await receptionContext(reception, null)).wifi.ssid).toBe("Reception-City");
  });

  it("lists, per scope, which settings are overridden and by which level", async () => {
    await updateSetting(damAdmin, "ticketing", { numberPad: 4 }, null, damCity);
    const s = await readSettingSources(damAdmin, { cityId: damCity });
    expect(s.ticketing).toMatchObject({ own: true, overridable: true, source: { level: "city" } });
    expect(s.wifi).toMatchObject({ own: false, overridable: true, source: { level: "organization" } });
    expect(s.branding).toMatchObject({ own: false, overridable: false });
    expect((await readAllSettings(damAdmin, null, damCity)).ticketing.numberPad).toBe(4);
    expect((await readAllSettings(superAdmin)).ticketing.numberPad).toBe(3);
  });

  it("a city admin edits only their own city; the organization and other cities are off limits", async () => {
    await expectCode(updateSetting(damAdmin, "wifi", wifi("x")), "forbidden"); // organization value
    await expectCode(updateSetting(damAdmin, "wifi", wifi("x"), null, alpCity), "forbidden"); // another city
    await expectCode(updateSetting(damAdmin, "wifi", wifi("x"), alpBranch), "forbidden"); // another city's branch
    await expectCode(updateSetting(alpAdmin, "wifi", wifi("x"), null, damCity), "forbidden");
    await expectCode(clearSettingOverride(damAdmin, "wifi", null, alpCity), "forbidden");
    await expectCode(updateSetting(reception, "wifi", wifi("x"), null, damCity), "forbidden");

    await updateSetting(alpAdmin, "wifi", wifi("Aleppo-Guest"), null, alpCity);
    // ... and cannot look at another city's overrides either.
    await expectCode(readAllSettings(damAdmin, null, alpCity), "forbidden");
    await expectCode(readSettingSources(damAdmin, { cityId: alpCity }), "forbidden");
    expect((await readAllSettings(damAdmin)).wifi.ssid).not.toBe("Aleppo-Guest");

    // The super admin writes anywhere.
    await updateSetting(superAdmin, "wifi", wifi("Super-For-Aleppo"), null, alpCity);
    expect(await getSetting(org, "wifi", alpBranch)).toMatchObject({ ssid: "Super-For-Aleppo" });
  });

  it("keeps organization-level settings out of reach of city and branch scopes", async () => {
    for (const key of ["branding", "security", "privacy"]) {
      await expectCode(updateSetting(superAdmin, key, {}, null, damCity), "validation");
      await expectCode(updateSetting(superAdmin, key, {}, damBranch), "validation");
    }
    await expectCode(updateSetting(superAdmin, "wifi", wifi("x"), damBranch, damCity), "validation"); // one scope only
    await expectCode(clearSettingOverride(superAdmin, "wifi", null, null), "validation");
    // Settings that differ by city are city-overridable even where a branch may not override them.
    await updateSetting(damAdmin, "agentWork", { multipleVisitors: true }, null, damCity);
    expect((await getSetting(org, "agentWork", damBranch)).multipleVisitors).toBe(true);
    expect((await getSetting(org, "agentWork", alpBranch)).multipleVisitors).toBe(false);
    await expectCode(updateSetting(superAdmin, "agentWork", { multipleVisitors: true }, damBranch), "validation");
  });

  it("a branch created later in a city inherits the city's overrides", async () => {
    await updateSetting(damAdmin, "wifi", wifi("Damascus-Guest"), null, damCity);
    const { id } = await createBranch(damAdmin, {
      cityId: damCity,
      code: "DAM-77",
      name: { ar: "فرع جديد", en: "New branch" },
      timezone: "Asia/Damascus",
      weekend: [5, 6],
    });
    expect((await getSetting(org, "wifi", id)).ssid).toBe("Damascus-Guest");
    expect((await getSettingSource(org, "wifi", { branchId: id })).source.level).toBe("city");
  });

  it("audits every change with its scope", async () => {
    await updateSetting(damAdmin, "wifi", wifi("Damascus-Guest"), null, damCity);
    await clearSettingOverride(damAdmin, "wifi", null, damCity);
    await updateSetting(damAdmin, "wifi", wifi("Branch"), damBranch);
    const { items } = await listAudit(superAdmin, { entityType: "setting" });
    const city = items.find((i) => i.action === "setting.city_updated");
    expect(city).toMatchObject({ entityId: "wifi", after: { cityId: damCity, value: { ssid: "Damascus-Guest" } } });
    expect(items.some((i) => i.action === "setting.city_override_cleared")).toBe(true);
    expect(items.find((i) => i.action === "setting.updated")?.branchId).toBe(damBranch);
    const [row] = await db().select().from(auditLogs).where(eq(auditLogs.action, "setting.city_updated"));
    expect(row.actorUserId).toBe(damAdmin.auth.user.id);
  });

  it("tells the screens of exactly the affected branches to refresh", async () => {
    const wall = { theme: "light" };
    await updateSetting(damAdmin, "wallboard", wall, null, damCity);
    expect(emitted).toEqual([`screens:${damBranch}:display.refresh`]);
    emitted.length = 0;
    await updateSetting(damAdmin, "displayTheme", { theme: "light" }, damBranch);
    expect(emitted).toEqual([`screens:${damBranch}:display.refresh`]);
    emitted.length = 0;
    await clearSettingOverride(damAdmin, "wallboard", null, damCity);
    expect(emitted).toEqual([`screens:${damBranch}:display.refresh`]);
    emitted.length = 0;
    await updateSetting(superAdmin, "voice", { enabled: false });
    expect(emitted).toEqual([`displays:${org}:display.refresh`]);
    emitted.length = 0;
    await updateSetting(damAdmin, "ticketing", { numberPad: 5 }, null, damCity); // not a screen setting
    expect(emitted).toEqual([]);
  });

  it("copies a city's configuration to another city (organization-wide administrators only)", async () => {
    await updateSetting(damAdmin, "wifi", wifi("Damascus-Guest"), null, damCity);
    await updateSetting(damAdmin, "ticketing", { numberPad: 5 }, null, damCity);
    await updateSetting(alpAdmin, "reception", { oneTapIssue: false }, null, alpCity);
    const [reason] = await db().select().from(visitReasons);
    await setCityReason(damAdmin, damCity, { reasonId: reason.id, enabled: false });

    await expectCode(copyCityConfiguration(damAdmin, damCity, alpCity), "forbidden");
    await expectCode(copyCityConfiguration(superAdmin, damCity, damCity), "validation");
    expect(await copyCityConfiguration(superAdmin, damCity, alpCity)).toEqual({ settings: 2, hiddenReasons: 1 });

    expect(await getSetting(org, "wifi", alpBranch)).toMatchObject({ ssid: "Damascus-Guest" });
    expect((await getSetting(org, "ticketing", alpBranch)).numberPad).toBe(5);
    expect((await getSetting(org, "reception", alpBranch)).oneTapIssue).toBe(true); // replaced, not merged
    expect((await listCityReasons(alpAdmin, alpCity)).find((r) => r.id === reason.id)?.enabled).toBe(false);

    const overview = await listCityOverrides(superAdmin);
    expect(overview.find((o) => o.cityId === alpCity)).toMatchObject({ hiddenReasons: 1 });
    expect(overview.find((o) => o.cityId === alpCity)!.overrides.sort()).toEqual(["ticketing", "wifi"]);
    // A city admin only sees their own city in the overview.
    expect((await listCityOverrides(damAdmin)).map((o) => o.cityId)).toEqual([damCity]);
  });

  it("city shifts are visible only to their city and only usable by its agents", async () => {
    const input = (code: string, cityId: string | null) => ({
      code,
      name: { ar: "وردية", en: code },
      startsAt: "09:00",
      endsAt: "17:00",
      sortOrder: 5,
      cityId,
    });
    await expectCode(createShift(damAdmin, input("ORG-X", null)), "forbidden"); // organization shifts: super admin
    await expectCode(createShift(damAdmin, input("ALP-X", alpCity)), "forbidden");
    await createShift(damAdmin, input("DAM-X", damCity));
    await createShift(superAdmin, input("ORG-X", null));
    const codes = async (a: Actor) => (await listShifts(a)).map((s) => s.code);
    expect(await codes(damAdmin)).toEqual(expect.arrayContaining(["DAM-X", "ORG-X"]));
    expect(await codes(alpAdmin)).not.toContain("DAM-X");
    expect(await codes(alpAdmin)).toContain("ORG-X");
    expect(await codes(superAdmin)).toContain("DAM-X");
    const [s] = await db()
      .select()
      .from(shifts)
      .where(and(eq(shifts.code, "DAM-X")));
    expect(s.cityId).toBe(damCity);
  });

  it("a city can hide a reason: it disappears from reception and cannot be issued there", async () => {
    const [reason] = await db().select().from(visitReasons).where(eq(visitReasons.code, "general"));
    const rows = await listCityReasons(damAdmin, damCity);
    expect(rows.every((r) => r.enabled)).toBe(true); // default: everything enabled
    const open = async () => (await receptionContext(reception, damBranch)).reasons.map((r: { id: string }) => r.id);
    expect(await open()).toContain(reason.id);

    await expectCode(setCityReason(damAdmin, alpCity, { reasonId: reason.id, enabled: false }), "forbidden");
    await setCityReason(damAdmin, damCity, { reasonId: reason.id, enabled: false });
    expect(await open()).not.toContain(reason.id);
    await expectCode(
      issueTicket(reception, {
        branchId: damBranch,
        reasonId: reason.id,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      }),
      "validation",
    );
    await expectCode(listCityReasons(damAdmin, alpCity), "forbidden");

    await setCityReason(damAdmin, damCity, { reasonId: reason.id, enabled: true });
    expect(await open()).toContain(reason.id);
  });

  it("a city can word its own messages; the organization's wording stays for the other cities", async () => {
    const base = {
      channel: "sms" as const,
      event: "ticket_issued",
      body: { ar: "{ticket} للمؤسسة", en: "{ticket} org" },
      isActive: true,
    };
    await saveTemplate(superAdmin, base);
    await saveTemplate(damAdmin, { ...base, body: { ar: "{ticket} دمشق", en: "{ticket} damascus" }, cityId: damCity });
    await expectCode(saveTemplate(damAdmin, base), "forbidden");
    await expectCode(saveTemplate(damAdmin, { ...base, cityId: alpCity }), "forbidden");

    expect((await templateFor(org, "sms", "ticket_issued", damCity))?.body.en).toBe("{ticket} damascus");
    expect((await templateFor(org, "sms", "ticket_issued", alpCity))?.body.en).toBe("{ticket} org");
    expect((await templateFor(org, "sms", "ticket_issued"))?.body.en).toBe("{ticket} org");
    expect((await listTemplates(damAdmin, damCity)).map((t) => t.body.en)).toEqual(["{ticket} damascus"]);

    await deleteCityTemplate(damAdmin, damCity, "sms", "ticket_issued");
    expect((await templateFor(org, "sms", "ticket_issued", damCity))?.body.en).toBe("{ticket} org");
  });
});
