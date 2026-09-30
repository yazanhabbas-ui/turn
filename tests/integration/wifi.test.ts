import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { branches } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { clearSettingOverride, readAllSettings, updateSetting } from "@/server/admin/settings-admin";
import { AppError } from "@/server/http/errors";
import { receptionContext } from "@/server/queue/views";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe.runIf(available)("Wi-Fi settings (database)", () => {
  let admin: Actor;
  let reception: Actor;
  let supervisor: Actor;
  let branchId: string;

  beforeEach(async () => {
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    reception = await actorFor("reception@dor.local");
    supervisor = await actorFor("supervisor@dor.local");
    [{ id: branchId }] = await db().select({ id: branches.id }).from(branches);
  });
  afterAll(async () => {
    await pool().end();
  });

  it("reaches the reception console only when turned on, and a branch can have its own network", async () => {
    expect((await receptionContext(reception, null)).wifi.enabled).toBe(false);

    await updateSetting(admin, "wifi", { enabled: true, ssid: "Office-Guest", password: "welcome2026", showQr: true });
    let wifi = (await receptionContext(reception, null)).wifi;
    expect(wifi).toMatchObject({ enabled: true, ssid: "Office-Guest", password: "welcome2026", showQr: true });

    await updateSetting(admin, "wifi", { enabled: true, ssid: "Branch-Guest", password: "", showQr: false }, branchId);
    wifi = (await receptionContext(reception, null)).wifi;
    expect(wifi).toMatchObject({ ssid: "Branch-Guest", password: "" });
    expect((await readAllSettings(admin)).wifi.ssid).toBe("Office-Guest"); // the default is untouched

    await clearSettingOverride(admin, "wifi", branchId);
    expect((await receptionContext(reception, null)).wifi.ssid).toBe("Office-Guest");

    await updateSetting(admin, "wifi", { enabled: false, ssid: "Office-Guest", password: "x", showQr: false });
    expect((await receptionContext(reception, null)).wifi.enabled).toBe(false);
  });

  it("only organization admins change the default; only overridable settings can be set per branch", async () => {
    await expectCode(updateSetting(supervisor, "wifi", { enabled: true, ssid: "x" }), "forbidden");
    await expectCode(updateSetting(reception, "wifi", { enabled: true, ssid: "x" }, branchId), "forbidden");
    await expectCode(updateSetting(admin, "security", { maxFailedLogins: 4 }, branchId), "validation");
    await expect(updateSetting(admin, "wifi", { ssid: "x".repeat(40) })).rejects.toBeDefined(); // fails schema validation
  });
});
