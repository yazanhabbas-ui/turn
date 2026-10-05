import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsKeyRoute from "@/app/api/v1/admin/settings/[key]/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as kioskContextRoute from "@/app/api/v1/kiosk/context/route";
import * as publicTicketRoute from "@/app/api/v1/public/tickets/[token]/route";
import { db, pool } from "@/db/client";
import { auditLogs, branches, cities, settings, visitReasons } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { createDisplay } from "@/server/admin/screens";
import { clearSettingOverride, readAllSettings, readSettingSources, updateSetting } from "@/server/admin/settings-admin";
import { authenticateDevice, pairDevice } from "@/server/display/device";
import { AppError } from "@/server/http/errors";
import { kioskContext } from "@/server/kiosk/service";
import { issueTicket } from "@/server/queue/tickets";
import { publicTicketStatus } from "@/server/queue/views";
import { getSetting } from "@/server/settings/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

// Records the device refreshes the server asks for.
const emitted: string[] = [];
vi.mock("@/server/realtime", () => ({
  io: () => ({ to: (room: string) => ({ emit: (event: string) => emitted.push(`${room}:${event}`) }) }),
}));

const available = await prepareTestDatabase();
const ORIGIN = "http://localhost:3000";
const meta = { ip: "10.0.0.7", userAgent: "vitest-pagecontent" };

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
function request(path: string, init: { method?: string; body?: unknown; cookie?: string; token?: string } = {}) {
  const headers = new Headers({ host: "localhost:3000", "x-dor-client-ip": "10.0.0.9", origin: ORIGIN });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return new NextRequest(new URL(path, ORIGIN), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function call(handler: unknown, req: NextRequest, params: Record<string, string> = {}) {
  const res = await (handler as Handler)(req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json(), cookie: res.headers.get("set-cookie") };
}
async function signIn(email: string) {
  const r = await call(loginRoute.POST, request("/api/v1/auth/login", { body: { email, password: "Dor@Demo2026" } }));
  expect(r.status).toBe(200);
  return r.cookie!.split(";")[0]!;
}
async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

const kioskTexts = (texts: Record<string, { ar?: string; en?: string }>, more: Record<string, unknown> = {}) => ({
  kiosk: { texts, ...more },
});
const visitorTexts = (texts: Record<string, { ar?: string; en?: string }>, more: Record<string, unknown> = {}) => ({
  visitor: { texts, ...more },
});

const config = {
  languages: ["ar", "en"] as ("ar" | "en")[],
  rotateSeconds: 15,
  zones: [],
  showTicker: true,
  showSlides: true,
  showWaiting: true,
  showClock: true,
  showHallOccupancy: true,
  theme: "default" as const,
  voice: {},
};

describe.runIf(available)("configurable kiosk and visitor page content (database)", () => {
  let superAdmin: Actor;
  let damAdmin: Actor;
  let alpAdmin: Actor;
  let reception: Actor;
  let org: string;
  let damCity: string;
  let alpCity: string;
  let damBranch: string;
  let alpBranch: string;
  let reasonId: string;

  async function kiosk(branchId: string) {
    const created = await createDisplay(superAdmin, { name: "Kiosk", branchId, kind: "kiosk", layout: "classic", config });
    const { token } = await pairDevice(created.pairingCode, meta, "kiosk");
    return { token, device: await authenticateDevice(token, {}, "kiosk") };
  }
  const ticketAt = async (branchId: string) =>
    (await issueTicket(superAdmin, { branchId, reasonId, language: "ar", fields: {}, consent: false, source: "reception" }))
      .ticket;

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
    reasonId = (await db().select().from(visitReasons).where(eq(visitReasons.code, "general")))[0]!.id;
  });
  afterAll(async () => {
    await pool().end();
  });

  it("round-trips the organization value and audits the change", async () => {
    const saved = await updateSetting(superAdmin, "pageContent", {
      ...kioskTexts({ back: { en: "Go back", ar: "ارجع" } }, { tilesPerRowLandscape: 2, headerStyle: "plain" }),
      ...visitorTexts({ called: { en: "Please go to {desk}" } }, { supportPhone: "+963 11 123 4567", showWifi: true }),
    });
    expect((saved as { kiosk: { texts: unknown } }).kiosk.texts).toEqual({ back: { en: "Go back", ar: "ارجع" } });
    const read = await getSetting(org, "pageContent");
    expect(read.kiosk).toMatchObject({ tilesPerRowLandscape: 2, headerStyle: "plain", showLogo: true });
    expect(read.visitor).toMatchObject({
      supportPhone: "+963 11 123 4567",
      showWifi: true,
      texts: { called: { en: "Please go to {desk}" } },
    });
    expect((await readAllSettings(superAdmin)).pageContent.kiosk.texts.back?.en).toBe("Go back");
    const logs = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "setting"), eq(auditLogs.entityId, "pageContent")));
    expect(logs.map((l) => l.action)).toContain("setting.updated");
  });

  it("stores HTML as plain text", async () => {
    await updateSetting(superAdmin, "pageContent", kioskTexts({ back: { en: '<img src=x onerror="alert(1)">Back <b>now</b>' } }));
    const [row] = await db()
      .select()
      .from(settings)
      .where(and(eq(settings.key, "pageContent"), eq(settings.organizationId, org)));
    const stored = (row!.value as { kiosk: { texts: { back: { en: string } } } }).kiosk.texts.back.en;
    expect(stored).toBe("Back now");
    expect(JSON.stringify(row!.value)).not.toMatch(/<|onerror/);
  });

  it("rejects bad input and stores nothing", async () => {
    const bad = [
      kioskTexts({ back: { en: "{secret}" } }), // placeholder this text may not use
      kioskTexts({ nothing: { en: "x" } }), // not a text of the page
      kioskTexts({ back: { en: "x".repeat(41) } }), // too long
      kioskTexts({}, { tilesPerRowLandscape: 9 }),
      visitorTexts({}, { customLinks: [{ label: { en: "x" }, url: "javascript:alert(1)" }] }),
      visitorTexts({}, { customLinks: [{ label: { en: "x" }, url: "http://example.com" }] }),
      visitorTexts({}, { supportEmail: "nope" }),
    ];
    for (const value of bad) await expect(updateSetting(superAdmin, "pageContent", value)).rejects.toBeTruthy();
    expect(await db().select().from(settings).where(eq(settings.key, "pageContent"))).toHaveLength(0);
  });

  it("answers 400 validation over HTTP for an unknown placeholder or a javascript: link", async () => {
    const cookie = await signIn("admin@dor.local");
    const put = (body: unknown) =>
      call(settingsKeyRoute.PUT, request("/api/v1/admin/settings/pageContent", { method: "PUT", body, cookie }), {
        key: "pageContent",
      });
    const placeholder = await put(kioskTexts({ back: { en: "{secret}" } }));
    expect(placeholder.status).toBe(400);
    expect(placeholder.json.error.code).toBe("validation");
    expect(JSON.stringify(placeholder.json.error.details.issues)).toContain("unknown_placeholder");
    const link = await put(visitorTexts({}, { customLinks: [{ label: { en: "x" }, url: "javascript:alert(1)" }] }));
    expect(link.status).toBe(400);
    expect(JSON.stringify(link.json.error.details.issues)).toContain("url_https_only");
    expect((await put(kioskTexts({ back: { en: "Back" } }))).status).toBe(200);
  });

  it("lets a city admin write their own city and branches only, others get 403", async () => {
    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "Damascus back" } }), null, damCity);
    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "Branch back" } }), damBranch);
    await expectCode(updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "x" } })), "forbidden"); // organization
    await expectCode(updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "x" } }), null, alpCity), "forbidden");
    await expectCode(updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "x" } }), alpBranch), "forbidden");
    await expectCode(updateSetting(alpAdmin, "pageContent", kioskTexts({ back: { en: "x" } }), damBranch), "forbidden");
    await expectCode(updateSetting(reception, "pageContent", kioskTexts({ back: { en: "x" } }), damBranch), "forbidden");
    await expectCode(readAllSettings(damAdmin, null, alpCity), "forbidden");

    const cookie = await signIn("damascus.admin@dor.local");
    const orgWrite = await call(
      settingsKeyRoute.PUT,
      request("/api/v1/admin/settings/pageContent", { method: "PUT", body: kioskTexts({}), cookie }),
      { key: "pageContent" },
    );
    expect(orgWrite.status).toBe(403);
    const sources = await readSettingSources(damAdmin, { cityId: damCity });
    expect(sources.pageContent).toMatchObject({ overridable: true, own: true });
    expect((await readSettingSources(damAdmin, { branchId: damBranch })).pageContent).toMatchObject({
      overridable: true,
      own: true,
      source: { level: "branch" },
    });
  });

  it("gives the kiosk the wording of its branch: branch over city over organization, and reset goes back up", async () => {
    const dam = await kiosk(damBranch);
    const alp = await kiosk(alpBranch);
    const back = async (k: Awaited<ReturnType<typeof kiosk>>) => (await kioskContext(k.device)).pageContent.texts.back?.en;

    expect(await back(dam)).toBeUndefined(); // nothing configured: the message-file default applies on the kiosk
    await updateSetting(superAdmin, "pageContent", kioskTexts({ back: { en: "Org back" } }));
    expect(await back(dam)).toBe("Org back");
    expect(await back(alp)).toBe("Org back");

    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "City back" } }), null, damCity);
    expect(await back(dam)).toBe("City back");
    expect(await back(alp)).toBe("Org back"); // another city is untouched

    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "Branch back" } }), damBranch);
    expect(await back(dam)).toBe("Branch back");

    await clearSettingOverride(damAdmin, "pageContent", damBranch);
    expect(await back(dam)).toBe("City back");
    await clearSettingOverride(damAdmin, "pageContent", null, damCity);
    expect(await back(dam)).toBe("Org back");
    expect((await readSettingSources(superAdmin, { branchId: damBranch })).pageContent.source.level).toBe("organization");

    // The same answer over HTTP, with only the overridden texts in it.
    const res = await call(kioskContextRoute.GET, request("/api/v1/kiosk/context", { token: dam.token }));
    expect(res.status).toBe(200);
    expect(res.json.pageContent.texts).toEqual({ back: { en: "Org back" } });
  });

  it("keeps the welcome text of Self check-in working next to the page-content heading", async () => {
    const k = await kiosk(damBranch);
    await updateSetting(superAdmin, "selfCheckin", { enabled: true, welcomeText: { ar: "مرحباً بكم", en: "Hello there" } });
    let ctx = await kioskContext(k.device);
    expect(ctx.options.welcomeText).toEqual({ ar: "مرحباً بكم", en: "Hello there" });
    expect(ctx.pageContent.texts.welcome).toBeUndefined();
    await updateSetting(superAdmin, "pageContent", kioskTexts({ welcome: { en: "Welcome to {branch}" } }));
    ctx = await kioskContext(k.device);
    expect(ctx.pageContent.texts.welcome).toEqual({ en: "Welcome to {branch}" });
  });

  it("sends service descriptions only when the kiosk shows them", async () => {
    const k = await kiosk(damBranch);
    await updateSetting(superAdmin, "selfCheckin", { enabled: true });
    await db()
      .update(visitReasons)
      .set({ description: { ar: "وصف", en: "A description" } })
      .where(eq(visitReasons.id, reasonId));
    expect((await kioskContext(k.device)).reasons.every((r) => r.description === null)).toBe(true);
    await updateSetting(superAdmin, "pageContent", kioskTexts({}, { showReasonDescriptions: true }));
    const general = (await kioskContext(k.device)).reasons.find((r) => r.id === reasonId);
    expect(general?.description).toEqual({ ar: "وصف", en: "A description" });
  });

  it("gives the public status page the wording of the ticket's branch", async () => {
    const ticket = await ticketAt(damBranch);
    const other = await ticketAt(alpBranch);
    await updateSetting(
      superAdmin,
      "pageContent",
      visitorTexts({ waiting: { en: "Org waiting" } }, { footerText: { en: "Org footer" } }),
    );
    await updateSetting(damAdmin, "pageContent", visitorTexts({ waiting: { en: "Damascus waiting {ahead}" } }), null, damCity);
    const dam = await publicTicketStatus(ticket.publicToken);
    expect(dam?.pageContent.texts).toEqual({ waiting: { en: "Damascus waiting {ahead}" } });
    const alp = await publicTicketStatus(other.publicToken);
    expect(alp?.pageContent.texts).toEqual({ waiting: { en: "Org waiting" } });
    expect(alp?.pageContent.footerText).toEqual({ en: "Org footer" });

    const res = await call(publicTicketRoute.GET, request(`/api/v1/public/tickets/${ticket.publicToken}`), {
      token: ticket.publicToken,
    });
    expect(res.status).toBe(200);
    expect(res.json.pageContent.texts.waiting.en).toBe("Damascus waiting {ahead}");
  });

  it("applies the visitor-page options: Wi-Fi only when asked and on, opt-in can be hidden", async () => {
    const ticket = await ticketAt(damBranch);
    await updateSetting(superAdmin, "wifi", { enabled: true, ssid: "Guest-Net", password: "pass1234" });
    expect((await publicTicketStatus(ticket.publicToken))?.wifi).toBeNull();
    await updateSetting(superAdmin, "pageContent", visitorTexts({}, { showWifi: true }));
    expect((await publicTicketStatus(ticket.publicToken))?.wifi).toMatchObject({ ssid: "Guest-Net", password: "pass1234" });
    await updateSetting(superAdmin, "pageContent", visitorTexts({}, { showWifi: true, hideNotifyOptIn: true }));
    expect((await publicTicketStatus(ticket.publicToken))?.notifyOptIn).toBe(false);
  });

  it("asks the paired kiosks of the affected branches to refetch", async () => {
    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "B" } }), damBranch);
    expect(emitted).toEqual([`kiosk:${damBranch}:kiosk.refresh`]);
    emitted.length = 0;
    await updateSetting(damAdmin, "pageContent", kioskTexts({ back: { en: "C" } }), null, damCity);
    expect(emitted).toContain(`kiosk:${damBranch}:kiosk.refresh`);
    expect(emitted).not.toContain(`kiosk:${alpBranch}:kiosk.refresh`);
    emitted.length = 0;
    await updateSetting(superAdmin, "pageContent", kioskTexts({ back: { en: "D" } }));
    expect(emitted).toEqual([`kiosks:${org}:kiosk.refresh`]);
    emitted.length = 0;
    await clearSettingOverride(damAdmin, "pageContent", damBranch);
    expect(emitted).toEqual([`kiosk:${damBranch}:kiosk.refresh`]);
  });
});
