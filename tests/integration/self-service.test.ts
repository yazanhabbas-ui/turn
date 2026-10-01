import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as displayStateRoute from "@/app/api/v1/display/state/route";
import * as kioskContextRoute from "@/app/api/v1/kiosk/context/route";
import * as kioskTicketsRoute from "@/app/api/v1/kiosk/tickets/route";
import * as queueStateRoute from "@/app/api/v1/queue/state/route";
import { db, pool } from "@/db/client";
import {
  agentProfiles,
  branches,
  hallReasons,
  rolePermissions,
  roles,
  ticketEvents,
  tickets,
  users,
  visitReasons,
} from "@/db/schema";
import { zonedToUtc } from "@/domain/schedule/time";
import type { Actor } from "@/server/admin/actor";
import { enableAgentIssuing, issuingCoverage } from "@/server/admin/coverage";
import { createHall } from "@/server/halls/admin";
import { createDisplay, listDisplays, revokeDisplay } from "@/server/admin/screens";
import { updateSetting } from "@/server/admin/settings-admin";
import { setClock } from "@/server/clock";
import { authenticateDevice, pairDevice } from "@/server/display/device";
import { AppError } from "@/server/http/errors";
import { kioskContext, kioskIssue } from "@/server/kiosk/service";
import { agentIssue } from "@/server/queue/agent-issue";
import { branchHasReception, resetReceptionCache } from "@/server/queue/reception-status";
import { agentWorkspace, walkInContext } from "@/server/queue/views";
import { buildReport } from "@/server/reports/service";
import { putSetting } from "@/server/settings/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const meta = { ip: "10.0.0.7", userAgent: "vitest-kiosk" };

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) =>
      e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason || e.details?.field === reason),
  );
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function http(handler: unknown, path: string, token: string | null, body?: unknown) {
  const headers = new Headers({ host: "localhost:3000", origin: "http://localhost:3000", "x-dor-client-ip": "10.1.1.1" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const req = new NextRequest(new URL(path, "http://localhost:3000"), {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
}

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

describe.runIf(available)("running a branch without a receptionist (database)", () => {
  let admin: Actor;
  let damascusAdmin: Actor;
  let faisal: Actor; // agent in Aleppo (no receptionist there)
  let khalid: Actor; // agent in the main branch (reception is staffed)
  let reception: Actor;
  let mainId: string;
  let aleppoId: string;
  let org: string;
  const reason: Record<string, string> = {};
  let phoneSeq = 0;
  const phone = () => `09440${String(10000 + ++phoneSeq + Math.floor(Math.random() * 1000) * 100).slice(-5)}`;

  const walkIn = (actor: Actor, over: Record<string, unknown> = {}) =>
    agentIssue(actor, { reasonId: reason.general, language: "ar", fields: {}, consent: false, serveNow: false, ...over });

  async function kiosk(branchId: string, actor: Actor = admin) {
    const created = await createDisplay(actor, { name: "Kiosk", branchId, kind: "kiosk", layout: "classic", config });
    const { token } = await pairDevice(created.pairingCode, meta, "kiosk");
    return { id: created.id, token, device: await authenticateDevice(token, {}, "kiosk") };
  }
  const enableKiosk = (branchId: string, extra: Record<string, unknown> = {}) =>
    updateSetting(admin, "selfCheckin", { enabled: true, ...extra }, branchId);
  const take = (k: { device: Awaited<ReturnType<typeof authenticateDevice>> }, over: Record<string, unknown> = {}) =>
    kioskIssue(k.device, { reasonId: reason.general, language: "ar", fields: {}, consent: false, ...over });

  beforeEach(async () => {
    setClock(zonedToUtc("2026-09-29", "10:00", "Asia/Damascus"));
    org = await resetDemo();
    resetReceptionCache();
    admin = await actorFor("admin@dor.local");
    damascusAdmin = await actorFor("damascus.admin@dor.local");
    faisal = await actorFor("faisal@dor.local");
    khalid = await actorFor("khalid@dor.local");
    reception = await actorFor("reception@dor.local");
    const all = await db().select().from(branches);
    aleppoId = all.find((b) => b.code === "ALP-01")!.id;
    mainId = all.find((b) => b.code !== "ALP-01")!.id;
    for (const r of await db().select().from(visitReasons)) reason[r.code] = r.id;
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await pool().end();
  });

  it("knows whether a branch has a receptionist (administrators do not count)", async () => {
    expect(await branchHasReception(mainId)).toBe(true);
    expect(await branchHasReception(aleppoId)).toBe(false);
    await db().update(users).set({ isActive: false }).where(eq(users.id, reception.auth.user.id));
    resetReceptionCache();
    expect(await branchHasReception(mainId)).toBe(false);
  });

  it("lets agents issue walk-ins by setting and permission, and records the source", async () => {
    // Default: only where nobody is at the desk.
    const t = await walkIn(faisal);
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t.ticket.id));
    expect(row).toMatchObject({ source: "agent", status: "WAITING", branchId: aleppoId, issuedByUserId: faisal.auth.user.id });
    await expectCode(walkIn(khalid), "forbidden", "agent_issuing_off");
    expect((await agentWorkspace(khalid)).walkIn.allowed).toBe(false);
    expect((await agentWorkspace(faisal)).walkIn.allowed).toBe(true);
    expect((await walkInContext(faisal)).branch.id).toBe(aleppoId);

    // always / off, at the organization and overridden for one branch.
    await updateSetting(admin, "reception", { agentIssuing: "always" });
    resetReceptionCache();
    expect((await walkIn(khalid)).ticket.displayNumber).toBeTruthy();
    await updateSetting(admin, "reception", { agentIssuing: "off" });
    await expectCode(walkIn(faisal), "forbidden", "agent_issuing_off");
    await putSetting(org, "reception", { agentIssuing: "always" } as never, { branchId: aleppoId });
    expect((await walkIn(faisal)).duplicate).toBe(false);

    // Without the permission nothing is issued, whatever the setting says.
    const [role] = await db().select().from(roles).where(eq(roles.key, "agent"));
    await db().delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    const noPerm = await actorFor("faisal@dor.local");
    await expectCode(walkIn(noPerm), "forbidden");
    // Reception is unchanged: it still holds tickets.issue.
    expect(reception.auth.grants.some((g) => g.permissions.includes("tickets.issue"))).toBe(true);
  });

  it("serves a walk-in at once for the issuing agent only, within their capacity", async () => {
    const a = await walkIn(faisal, { serveNow: true });
    const [row] = await db().select().from(tickets).where(eq(tickets.id, a.ticket.id));
    expect(row).toMatchObject({ status: "SERVING", servingAgentId: faisal.auth.user.id });
    const types = (await db().select().from(ticketEvents).where(eq(ticketEvents.ticketId, a.ticket.id))).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["ISSUED", "CALLED", "STARTED"]));
    // One visitor at a time by default.
    await expectCode(walkIn(faisal, { serveNow: true }), "conflict", "at_capacity");
    await updateSetting(admin, "agentWork", { multipleVisitors: true, visitorsPerAgent: 2 });
    await walkIn(faisal, { serveNow: true });
    await expectCode(walkIn(faisal, { serveNow: true }), "conflict", "at_capacity");
    // A reason the agent does not serve cannot be taken by them.
    await expectCode(
      walkIn(faisal, { serveNow: true, reasonId: reason.complaint, fields: { phone: "0944011111" }, consent: true }),
      "validation",
      "agent_cannot_serve",
    );
  });

  it("pairs kiosks as their own device kind and keeps the tokens apart", async () => {
    const k = await kiosk(aleppoId);
    const shown = await createDisplay(admin, { name: "TV", branchId: aleppoId, layout: "classic", config });
    await expectCode(pairDevice(shown.pairingCode, meta, "kiosk"), "not_found");
    const tv = await pairDevice(shown.pairingCode, meta);
    await expectCode(authenticateDevice(k.token), "unauthorized"); // a kiosk token is not a screen token
    await expectCode(authenticateDevice(tv.token, {}, "kiosk"), "unauthorized"); // and the other way round
    await enableKiosk(aleppoId);
    expect((await http(displayStateRoute.GET, "/api/v1/display/state", k.token)).status).toBe(401);
    expect((await http(queueStateRoute.GET, "/api/v1/queue/state?branchId=" + aleppoId, k.token)).status).toBe(401);
    expect((await http(kioskContextRoute.GET, "/api/v1/kiosk/context", tv.token)).status).toBe(401);
    expect((await http(kioskTicketsRoute.POST, "/api/v1/kiosk/tickets", tv.token, { reasonId: reason.general })).status).toBe(
      401,
    );
    expect((await http(kioskTicketsRoute.POST, "/api/v1/kiosk/tickets", null, { reasonId: reason.general })).status).toBe(401);
    const ok = await http(kioskTicketsRoute.POST, "/api/v1/kiosk/tickets", k.token, { reasonId: reason.general });
    expect(ok.status).toBe(200);
    expect(ok.json.ticket.displayNumber).toBeTruthy();
    expect(ok.json.ticket.visitor).toBeUndefined();
    await revokeDisplay(admin, k.id);
    await expectCode(authenticateDevice(k.token, {}, "kiosk"), "unauthorized");
    expect((await http(kioskContextRoute.GET, "/api/v1/kiosk/context", k.token)).status).toBe(401);
  });

  it("offers only what a visitor may do alone and validates what they type", async () => {
    const k = await kiosk(aleppoId);
    expect((await kioskContext(k.device)).reasons).toHaveLength(0); // off by default
    await expectCode(take(k), "forbidden", "kiosk_disabled");
    await enableKiosk(aleppoId);
    const ctx = await kioskContext(k.device);
    const byId = Object.fromEntries(ctx.reasons.map((r) => [r.id, r]));
    expect(byId[reason.general].state).toBe("available");
    expect(byId[reason.contract].state).toBe("ask_staff"); // needs the ID digits, staff-only
    expect(byId[reason.complaint].intakeFields.map((f) => f.key)).toEqual(["phone", "name"]);
    await expectCode(
      take(k, { reasonId: reason.contract, fields: { name: "A", phone: phone(), national_id_last4: "1234" }, consent: true }),
      "forbidden",
      "ask_staff",
    );
    // Validation: missing, malformed, unexpected, consent.
    await expectCode(take(k, { reasonId: reason.complaint }), "validation", "phone");
    await expectCode(take(k, { reasonId: reason.complaint, fields: { phone: "12" }, consent: true }), "validation", "phone");
    await expectCode(
      take(k, { reasonId: reason.complaint, fields: { phone: phone(), company: "X" }, consent: true }),
      "validation",
      "company",
    );
    await expectCode(take(k, { reasonId: reason.complaint, fields: { phone: phone() } }), "validation", "consent_required");
    const ok = await take(k, { reasonId: reason.complaint, fields: { phone: phone(), name: "Layla" }, consent: true });
    const [row] = await db().select().from(tickets).where(eq(tickets.id, ok.ticket.id));
    expect(row.source).toBe("kiosk");
    // A reason flagged "requires staff", and one outside the allowed list, are refused.
    await db().update(visitReasons).set({ requiresStaff: true }).where(eq(visitReasons.id, reason.general));
    await expectCode(take(k), "forbidden", "ask_staff");
    await db().update(visitReasons).set({ requiresStaff: false }).where(eq(visitReasons.id, reason.general));
    await enableKiosk(aleppoId, { allowedReasons: [reason.general] });
    await expectCode(
      take(k, { reasonId: reason.complaint, fields: { phone: phone() }, consent: true }),
      "validation",
      "reasonId",
    );
  });

  it("limits abuse: duplicate phone, retries, waiting cap and rate", async () => {
    const k = await kiosk(aleppoId);
    await enableKiosk(aleppoId, { maxWaiting: 3, ratePerMinute: 6 });
    const p = phone();
    const first = await take(k, { reasonId: reason.complaint, fields: { phone: p }, consent: true });
    const again = await take(k, { reasonId: reason.complaint, fields: { phone: p }, consent: true });
    expect(again.duplicate).toBe(true);
    expect(again.ticket.id).toBe(first.ticket.id);
    // The same idempotency key never makes a second ticket.
    const a = await take(k, { idempotencyKey: "retry-key-0001" });
    const b = await take(k, { idempotencyKey: "retry-key-0001" });
    expect(b.ticket.id).toBe(a.ticket.id);
    // 2 waiting so far; the third fills the branch (cap 3), the fourth is refused.
    await take(k);
    await expectCode(take(k), "conflict", "queue_full");
    await enableKiosk(aleppoId, { maxWaiting: 0, ratePerMinute: 6 });
    await expectCode(take(k), "rate_limited"); // 6 attempts per minute already used on this kiosk
  });

  it("scopes kiosk management to the administrator's city", async () => {
    await kiosk(aleppoId);
    await expectCode(
      createDisplay(damascusAdmin, { name: "K", branchId: aleppoId, kind: "kiosk", layout: "classic", config }),
      "forbidden",
    );
    await createDisplay(damascusAdmin, { name: "K", branchId: mainId, kind: "kiosk", layout: "classic", config });
    const seen = await listDisplays(damascusAdmin);
    expect(seen.every((d) => d.branchId === mainId)).toBe(true);
    expect(seen.some((d) => d.kind === "kiosk")).toBe(true);
    expect((await issuingCoverage(damascusAdmin)).every((c) => c.branchId === mainId)).toBe(true);
  });

  it("reports branches with no way to issue tickets, and fixes them in one click", async () => {
    await updateSetting(admin, "reception", { agentIssuing: "off" }, aleppoId);
    let cov = await issuingCoverage(admin);
    expect(cov.find((c) => c.branchId === mainId)).toMatchObject({ hasReception: true, canIssue: true });
    expect(cov.find((c) => c.branchId === aleppoId)).toMatchObject({ hasReception: false, agentAllowed: false, canIssue: false });
    await enableAgentIssuing(damascusAdmin, mainId); // own city: fine
    await expectCode(enableAgentIssuing(damascusAdmin, aleppoId), "forbidden");
    await enableAgentIssuing(admin, aleppoId);
    cov = await issuingCoverage(admin);
    expect(cov.find((c) => c.branchId === aleppoId)).toMatchObject({ agentAllowed: true, canIssue: true });
  });

  it("flags hall services nobody can serve: halls off, no accepting hall, no host (D62)", async () => {
    const gaps = async () => (await issuingCoverage(admin)).find((c) => c.branchId === mainId)!.hallGaps;
    expect(await gaps()).toEqual([]); // no hall reasons yet: nothing to flag
    await db().update(visitReasons).set({ delivery: "hall" }).where(eq(visitReasons.code, "general"));
    const [reason] = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "general"));
    expect((await gaps()).map((g) => g.type)).toEqual(["halls_disabled"]);
    await updateSetting(admin, "halls", { enabled: true }, mainId);
    expect((await gaps()).map((g) => g.type).sort()).toEqual(["no_hall", "no_host"]);
    const other = await db().select({ id: visitReasons.id }).from(visitReasons).where(eq(visitReasons.code, "documents"));
    await db().update(visitReasons).set({ delivery: "hall" }).where(eq(visitReasons.code, "documents"));
    // A hall that accepts only "documents" leaves "general" without a hall.
    const { id: hallId } = await createHall(admin, mainId, {
      number: "1",
      name: { ar: "قاعة", en: "Hall" },
      capacity: 5,
      reasonIds: other.map((o) => o.id),
      sortOrder: 0,
    });
    const types = (await gaps()).map((g) => g.type).sort();
    expect(types).toEqual(["no_hall", "no_host"]);
    expect((await gaps()).find((g) => g.type === "no_hall")!.reasonIds).toEqual([reason.id]);
    // A host (default hall) closes the host gap; accepting everything closes the other.
    await db().update(agentProfiles).set({ defaultHallId: hallId }).where(eq(agentProfiles.branchId, mainId));
    expect((await gaps()).map((g) => g.type)).toEqual(["no_hall"]);
    await db().delete(hallReasons).where(eq(hallReasons.hallId, hallId));
    expect(await gaps()).toEqual([]);
    expect((await issuingCoverage(admin)).find((c) => c.branchId === mainId)!.hallsEnabled).toBe(true);
  });

  it("breaks tickets down by source in the report", async () => {
    await walkIn(faisal);
    const k = await kiosk(aleppoId);
    await enableKiosk(aleppoId);
    await take(k);
    const { data } = await buildReport(admin, { from: "2026-09-29", to: "2026-09-29" });
    expect(Object.fromEntries(data.bySource.map((s) => [s.source, s.visitors]))).toEqual({ agent: 1, kiosk: 1 });
  });
});
