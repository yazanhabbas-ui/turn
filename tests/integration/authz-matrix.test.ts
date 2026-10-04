/// <reference types="vite/client" />
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import {
  alerts,
  announcements,
  branches,
  cities,
  desks,
  displays,
  floors,
  hallSessions,
  halls,
  notificationsLog,
  reasonAssignments,
  reportSchedules,
  users,
  visitReasons,
} from "@/db/schema";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/domain/rbac/permissions";
import type { Actor } from "@/server/admin/actor";
import { createInvite } from "@/server/admin/invites";
import { createReportSchedule } from "@/server/admin/report-schedules";
import { createDisplay, saveAnnouncement } from "@/server/admin/screens";
import { putRule } from "@/server/admin/distribution";
import { saveGroup } from "@/server/admin/groups";
import { updateSetting } from "@/server/admin/settings-admin";
import { pairDevice } from "@/server/display/device";
import { createHall } from "@/server/halls/admin";
import { callGroup } from "@/server/halls/service";
import { issueTicket } from "@/server/queue/tickets";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

/**
 * Authorization matrix. Every route.ts under src/app/api is discovered from the file system, so a new endpoint is
 * covered the moment it exists:
 *  1. anonymous requests are refused (401) unless the route is in the explicit PUBLIC allow-list below;
 *  2. every route that names a permission refuses a signed-in user who lacks it (403);
 *  3. every route without a permission is in the SELF_SERVICE allow-list (the service decides) or is public;
 *  4. cross-city requests (a Damascus user against Aleppo data) are refused for the highest-risk endpoints.
 */
// The branding module is server-only (a Next.js build guard); under vitest it is just a module.
vi.mock("server-only", () => ({}));

const available = await prepareTestDatabase();

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const loaders = import.meta.glob("../../src/app/api/**/route.ts") as Record<string, () => Promise<Record<string, unknown>>>;
const sources = import.meta.glob("../../src/app/api/**/route.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** "../../src/app/api/v1/admin/users/[id]/route.ts" -> "v1/admin/users/[id]" (and "health" for src/app/api/health). */
const routeOf = (key: string) => key.replace(/^.*\/src\/app\/api\//, "").replace(/\/route\.ts$/, "");
const KEYS = Object.keys(loaders).sort();

/** Each export chunk of a route file: its method and the options text up to the next export. */
function chunksOf(source: string): { method: Method; text: string }[] {
  const re = /export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g;
  const found = [...source.matchAll(re)];
  return found.map((m, i) => ({
    method: m[1] as Method,
    text: source.slice(m.index!, i + 1 < found.length ? found[i + 1].index! : undefined),
  }));
}

/** Routes that anyone may call without a session, each with the reason it is safe. */
const PUBLIC: Record<string, string> = {
  "GET health": "liveness probe: returns only ok/not ok",
  "GET ready": "readiness probe for the orchestrator: returns only ready/not ready",
  "POST v1/auth/login": "sign-in; rate limited per address and per account lockout",
  "POST v1/auth/logout": "ends the caller's own session if any; nothing to read or write otherwise",
  "GET v1/display/state": "waiting-room screens authenticate with their device token (401 without it); rate limited",
  "GET v1/display/tts":
    "announcement audio for waiting-room screens (device token) and the admin voice test (session); 401 without either; rate limited",
  "POST v1/kiosk/pair":
    "exchanges a one-time pairing code (kind kiosk only) for a device token; rate limited per address and globally",
  "GET v1/kiosk/context":
    "self check-in kiosks authenticate with their own device token (kind kiosk; 401 otherwise); rate limited",
  "POST v1/kiosk/tickets": "a visitor takes a ticket at a kiosk: device token of kind kiosk, bound to its branch; rate limited",
  "GET v1/public/branding/logo": "the logo is shown on the login page and tickets; carries no personal data",
  "POST v1/public/display/pair": "exchanges a one-time pairing code for a device token; rate limited per address and globally",
  "GET v1/public/invites/[token]": "invite link (160-bit random token, hashed at rest); rate limited",
  "POST v1/public/invites/[token]": "accepts an invite with its token; rate limited",
  "GET v1/public/password-reset/[token]": "reset link (160-bit random token, hashed at rest); rate limited",
  "POST v1/public/password-reset/[token]": "completes a reset with its token; rate limited",
  "POST v1/public/signup":
    "a prospective staff member asks for an account; only stores a pending request (no account, no access until an admin approves); same answer whether or not the email is known; rate limited",
  "GET v1/public/tickets/[token]": "visitor status page; the 160-bit ticket token is the credential; rate limited",
  "POST v1/public/tickets/[token]/contact": "visitor adds a phone for updates, with consent; token + rate limited",
  "POST v1/public/tickets/[token]/feedback": "visitor rates a completed visit once; token + rate limited",
  "POST v1/public/tickets/[token]/stop": "visitor opts out of messages; needs the HMAC signature from the link; rate limited",
};
/** Public routes that need no rate limit of their own, with the reason. */
const PUBLIC_WITHOUT_LIMIT = new Set(["GET health", "GET ready", "POST v1/auth/logout", "GET v1/public/branding/logo"]);

/** Signed-in routes with no `permission` option: the service behind them decides, per record. */
const SELF_SERVICE: Record<string, string> = {
  "GET v1/queue/state": "queueState checks tickets.view / agent.serve for the requested branch",
  "POST v1/queue/tickets/[id]/actions": "ticketAction checks the permission of each action for the ticket's branch, or ownership",
  "POST v1/auth/locale": "changes the caller's own language",
  "GET v1/auth/me": "the caller's own session (also while the second factor is pending)",
  "POST v1/auth/password": "caller's own password; needs the current password",
  "POST v1/auth/totp/setup": "caller's own 2FA enrolment",
  "POST v1/auth/totp/enable": "caller's own 2FA enrolment",
  "POST v1/auth/totp/disable": "caller's own 2FA; needs the password",
  "POST v1/auth/totp/verify": "second step of the caller's own sign-in",
  "GET v1/me/activity": "caller's own activity only",
  "GET v1/me/progress": "caller's own progress only",
  "GET v1/me/report": "caller's own report only (agents)",
  "GET v1/me/report/details": "caller's own report only (agents)",
  "GET v1/me/report/export": "caller's own report only; there is no way to name another user",
  "POST v1/me/avatar": "caller's own picture",
  "DELETE v1/me/avatar": "caller's own picture",
  "GET v1/users/[id]/avatar": "pictures are shown across the organization (pickers, headers); same organization only",
  "DELETE v1/users/[id]/avatar": "own picture, or users.manage within scope (removeAvatar)",
};

const UUID = "00000000-0000-4000-8000-000000000001";
const paramsFor = (route: string) =>
  Object.fromEntries([...route.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], m[1] === "token" ? "x".repeat(32) : UUID]));
let ipCounter = 0;
function request(
  path: string,
  method: string,
  opts: { cookie?: string; body?: unknown; search?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({
    host: "localhost:3000",
    "x-dor-client-ip": `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
  });
  if (method !== "GET") headers.set("origin", "http://localhost:3000");
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.cookie) headers.set("cookie", opts.cookie);
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
  return new NextRequest(new URL(path + (opts.search ?? ""), "http://localhost:3000"), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function handlerFor(route: string, method: Method): Promise<Handler> {
  const key = KEYS.find((k) => routeOf(k) === route);
  if (!key) throw new Error(`no route ${route}`);
  const mod = await loaders[key]();
  const h = mod[method] as Handler | undefined;
  if (!h) throw new Error(`${method} ${route} is not exported`);
  return h;
}

/** Calls a route handler directly. `route` has the [param] placeholders; `params` fills them. */
async function http(
  route: string,
  method: Method,
  opts: {
    cookie?: string;
    body?: unknown;
    params?: Record<string, string>;
    search?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const h = await handlerFor(route, method);
  const params = { ...paramsFor(route), ...(opts.params ?? {}) };
  const path = "/api/" + route.replace(/\[(\w+)\]/g, (_m, n: string) => params[n]);
  const res = await h(request(path, method, opts), { params: Promise.resolve(params) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers };
}

async function signIn(email: string): Promise<string> {
  const h = await handlerFor("v1/auth/login", "POST");
  const res = await h(request("/api/v1/auth/login", "POST", { body: { email, password: "Dor@Demo2026" } }), {
    params: Promise.resolve({}),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("route discovery", () => {
  it("finds the API routes on the file system", () => {
    expect(KEYS.length).toBeGreaterThan(80);
    expect(KEYS.map(routeOf)).toContain("v1/admin/users/[id]/actions");
  });

  it("only exports HTTP methods the wrapper knows, and every handler is wrapped with route() (or is a probe)", () => {
    for (const key of KEYS) {
      const route = routeOf(key);
      const chunks = chunksOf(sources[key]);
      expect(chunks.length, route).toBeGreaterThan(0);
      for (const c of chunks) {
        if (route === "health" || route === "ready") continue;
        expect(c.text, `${c.method} ${route} must use route()`).toMatch(/=\s*route\(/);
      }
    }
  });

  it("keeps the allow-lists honest: no entry points at a route or method that no longer exists", () => {
    const existing = new Set(KEYS.flatMap((k) => chunksOf(sources[k]).map((c) => `${c.method} ${routeOf(k)}`)));
    for (const entry of [...Object.keys(PUBLIC), ...Object.keys(SELF_SERVICE)]) expect(existing.has(entry), entry).toBe(true);
  });

  it("every route is public (allow-listed), names a permission, or is allow-listed as self-service", () => {
    const unexplained: string[] = [];
    for (const key of KEYS) {
      for (const c of chunksOf(sources[key])) {
        const id = `${c.method} ${routeOf(key)}`;
        const isPublic = /auth:\s*"public"/.test(c.text) || id in PUBLIC;
        if (isPublic && !(id in PUBLIC)) {
          unexplained.push(`${id} is public but not in the PUBLIC allow-list`);
          continue;
        }
        if (id in PUBLIC) continue;
        const permission = /permission:\s*"([a-z._]+)"/.exec(c.text)?.[1];
        if (permission) {
          if (!(ALL_PERMISSIONS as string[]).includes(permission))
            unexplained.push(`${id} names an unknown permission ${permission}`);
          continue;
        }
        if (!(id in SELF_SERVICE)) unexplained.push(`${id} has no permission and is not in SELF_SERVICE`);
      }
    }
    expect(unexplained).toEqual([]);
  });

  it("public routes (other than the listed exceptions) declare a rate limit", () => {
    const missing: string[] = [];
    for (const key of KEYS) {
      for (const c of chunksOf(sources[key])) {
        const id = `${c.method} ${routeOf(key)}`;
        if (id in PUBLIC && !PUBLIC_WITHOUT_LIMIT.has(id) && !/rateLimit/.test(c.text) && !/const limit\b/.test(sources[key]))
          missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  it("mutating routes never read the session from anything but the cookie wrapper (no custom auth)", () => {
    for (const key of KEYS) {
      const src = sources[key];
      expect(src, routeOf(key)).not.toMatch(/validateSessionToken|cookies\(\)/);
    }
  });
});

afterAll(async () => {
  if (available) await pool().end();
});

describe.runIf(available)("anonymous requests are refused everywhere except the public allow-list", () => {
  for (const key of KEYS) {
    for (const c of chunksOf(sources[key])) {
      const route = routeOf(key);
      const id = `${c.method} ${route}`;
      it(id, async () => {
        const res = await http(route, c.method, { body: c.method === "GET" ? undefined : {} });
        if (id in PUBLIC) {
          // Reachable without a session, but never a server error for a bogus token or empty body.
          expect(res.status, id).toBeLessThan(500);
          if (id === "GET v1/display/state") expect(res.status).toBe(401);
        } else {
          expect(res.status, id).toBe(401);
          expect(res.json).toMatchObject({ error: { code: "unauthorized" } });
        }
      });
    }
  }
});

describe.runIf(available)("permission-protected routes refuse a signed-in user without the permission", () => {
  let agentCookie: string;
  let agentPermissions: Set<string>;

  beforeAll(async () => {
    await resetDemo();
    agentCookie = await signIn("khalid@dor.local");
    agentPermissions = new Set(SYSTEM_ROLES.agent);
  });

  for (const key of KEYS) {
    for (const c of chunksOf(sources[key])) {
      const permission = /permission:\s*"([a-z._]+)"/.exec(c.text)?.[1];
      if (!permission) continue;
      const route = routeOf(key);
      it(`${c.method} ${route} needs ${permission}`, async () => {
        if (agentPermissions.has(permission)) return; // the agent legitimately holds it; scope is covered below
        const res = await http(route, c.method, { cookie: agentCookie, body: c.method === "GET" ? undefined : {} });
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({ error: { code: "forbidden" } });
      });
    }
  }

  it("a cookie-authenticated mutation from another origin is refused before anything else", async () => {
    const h = await handlerFor("v1/admin/roles", "POST");
    const headers = new Headers({
      host: "localhost:3000",
      origin: "https://evil.example",
      cookie: agentCookie,
      "content-type": "application/json",
    });
    const res = await h(new NextRequest("http://localhost:3000/api/v1/admin/roles", { method: "POST", headers, body: "{}" }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("bad_origin");
  });
});

describe.runIf(available)("cross-city isolation (a Damascus user against Aleppo data)", () => {
  const cookies: Record<string, string> = {};
  let aleppoBranch: string;
  let damascusBranch: string;
  let aleppoCity: string;
  let faisalId: string;
  let aleppoDesk: string;
  let aleppoFloor: string;
  let aleppoHall: string;
  let aleppoSession: string;
  let aleppoDisplay: string;
  let aleppoAnnouncement: string;
  let aleppoSchedule: string;
  let aleppoInvite: string;
  let aleppoNotification: string;
  let aleppoAlert: string;
  let aleppoTicket: string;
  let aleppoGroup: string;
  let generalReason: string;
  let superAdmin: Actor;
  let aleppoAdmin: Actor;

  beforeAll(async () => {
    await resetDemo();
    for (const e of ["damascus.admin", "reception", "khalid", "aleppo.admin", "supervisor"])
      cookies[e] = await signIn(`${e}@dor.local`);
    superAdmin = await actorFor("admin@dor.local");
    aleppoAdmin = await actorFor("aleppo.admin@dor.local");
    const bs = await db().select().from(branches);
    aleppoBranch = bs.find((b) => b.code === "ALP-01")!.id;
    damascusBranch = bs.find((b) => b.code === "DAM-01")!.id;
    aleppoCity = (await db().select().from(cities)).find((c) => c.code === "ALP")!.id;
    faisalId = (await db().select().from(users).where(eq(users.email, "faisal@dor.local")))[0].id;
    generalReason =
      (await db().select().from(visitReasons)).find((r) => r.code === "general")?.id ??
      (await db().select().from(visitReasons))[0].id;

    aleppoDesk = (await db().select().from(desks).where(eq(desks.branchId, aleppoBranch)))[0]?.id;
    const [f] = await db()
      .insert(floors)
      .values({ organizationId: superAdmin.auth.user.organizationId, branchId: aleppoBranch, name: { ar: "طابق" } })
      .returning();
    aleppoFloor = f.id;
    if (!aleppoDesk) {
      const [d] = await db()
        .insert(desks)
        .values({
          organizationId: superAdmin.auth.user.organizationId,
          branchId: aleppoBranch,
          number: "9",
          name: { ar: "مكتب" },
        })
        .returning();
      aleppoDesk = d.id;
    }
    aleppoDisplay = (
      await createDisplay(aleppoAdmin, {
        name: "Aleppo TV",
        branchId: aleppoBranch,
        kind: "display",
        layout: "classic",
        config: {},
      } as never)
    ).id;
    aleppoAnnouncement = (
      await saveAnnouncement(aleppoAdmin, null, {
        kind: "ticker",
        body: { ar: "إعلان" },
        durationSeconds: 10,
        branchId: aleppoBranch,
        sortOrder: 0,
        isActive: true,
      })
    ).id;
    aleppoSchedule = (
      await createReportSchedule(aleppoAdmin, {
        name: "Aleppo daily",
        frequency: "daily",
        sendHour: 7,
        format: "csv",
        locale: "en",
        branchId: aleppoBranch,
        recipients: ["boss@example.com"],
        isActive: true,
      } as never)
    ).id;
    aleppoInvite = (
      await createInvite(aleppoAdmin, {
        email: "newcomer@example.com",
        roleId: (await db().query.roles.findFirst({ where: (r, { eq: e }) => e(r.key, "agent") }))!.id,
        branchId: aleppoBranch,
        channels: [],
        locale: "ar",
      })
    ).id;
    const [n] = await db()
      .insert(notificationsLog)
      .values({
        organizationId: superAdmin.auth.user.organizationId,
        branchId: aleppoBranch,
        ticketId: UUID,
        channel: "sms",
        provider: "mock",
        event: "ticket_issued",
        status: "failed",
        payload: { channels: ["sms"] },
      })
      .returning();
    aleppoNotification = n.id;
    const [a] = await db()
      .insert(alerts)
      .values({ organizationId: superAdmin.auth.user.organizationId, branchId: aleppoBranch, type: "queue_over_limit" })
      .returning();
    aleppoAlert = a.id;
    aleppoGroup = (
      await saveGroup(aleppoAdmin, null, { name: { ar: "مجموعة حلب" }, branchId: aleppoBranch, memberIds: [faisalId] })
    ).id;
    aleppoTicket = (
      await issueTicket(superAdmin, {
        branchId: aleppoBranch,
        reasonId: generalReason,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      } as never)
    ).ticket.id;
    await putRule(aleppoAdmin, { scope: "branch", branchId: aleppoBranch, config: {} });
    await updateSetting(aleppoAdmin, "wifi", { enabled: false } as never, aleppoBranch);
    // A hall with a live group session in Aleppo (D62).
    await db().update(visitReasons).set({ delivery: "hall", intakeFields: [] }).where(eq(visitReasons.id, generalReason));
    await updateSetting(aleppoAdmin, "halls", { enabled: true } as never, aleppoBranch);
    aleppoHall = (
      await createHall(aleppoAdmin, aleppoBranch, { number: "1", name: { ar: "قاعة" }, capacity: 4, reasonIds: [], sortOrder: 0 })
    ).id;
    for (let i = 0; i < 2; i++)
      await issueTicket(superAdmin, {
        branchId: aleppoBranch,
        reasonId: generalReason,
        language: "ar",
        fields: {},
        consent: false,
        source: "reception",
      } as never);
    aleppoSession = (await callGroup(await actorFor("faisal@dor.local"), { hallId: aleppoHall })).session!.id;
  });

  const refused = (status: number) => expect([403, 404]).toContain(status);

  it("a city admin cannot read or change another city's people, branches, desks, floors or screens", async () => {
    const c = cookies["damascus.admin"];
    refused(
      (
        await http("v1/admin/users/[id]", "PUT", {
          cookie: c,
          params: { id: faisalId },
          body: { email: "faisal@dor.local", displayName: { ar: "x" }, grants: [] },
        })
      ).status,
    );
    for (const action of ["deactivate", "force_logout", "reset_2fa", "reset_password"] as const)
      refused(
        (await http("v1/admin/users/[id]/actions", "POST", { cookie: c, params: { id: faisalId }, body: { action } })).status,
      );
    refused((await http("v1/admin/branches/[id]", "DELETE", { cookie: c, params: { id: aleppoBranch } })).status);
    refused(
      (
        await http("v1/admin/branches/[id]/desks", "POST", {
          cookie: c,
          params: { id: aleppoBranch },
          body: { number: "77", name: { ar: "x" } },
        })
      ).status,
    );
    refused(
      (
        await http("v1/admin/branches/[id]/floors", "POST", {
          cookie: c,
          params: { id: aleppoBranch },
          body: { name: { ar: "x" } },
        })
      ).status,
    );
    refused((await http("v1/admin/desks/[id]", "DELETE", { cookie: c, params: { id: aleppoDesk } })).status);
    refused((await http("v1/admin/floors/[id]", "DELETE", { cookie: c, params: { id: aleppoFloor } })).status);
    refused((await http("v1/admin/displays/[id]", "DELETE", { cookie: c, params: { id: aleppoDisplay } })).status);
    refused((await http("v1/admin/displays/[id]/revoke", "POST", { cookie: c, params: { id: aleppoDisplay } })).status);
    refused((await http("v1/admin/displays/[id]/pairing", "POST", { cookie: c, params: { id: aleppoDisplay } })).status);
    const [d] = await db().select().from(displays).where(eq(displays.id, aleppoDisplay));
    expect(d.archivedAt).toBeNull();
    expect(d.revokedAt).toBeNull();
  });

  it("halls and group sessions of another city can be neither managed nor hosted by outsiders", async () => {
    const c = cookies["damascus.admin"];
    refused(
      (
        await http("v1/admin/branches/[id]/halls", "POST", {
          cookie: c,
          params: { id: aleppoBranch },
          body: { number: "9", name: { ar: "x" }, capacity: 5, reasonIds: [] },
        })
      ).status,
    );
    refused(
      (
        await http("v1/admin/halls/[id]", "PUT", {
          cookie: c,
          params: { id: aleppoHall },
          body: { number: "1", name: { ar: "x" }, capacity: 9, reasonIds: [] },
        })
      ).status,
    );
    refused((await http("v1/admin/halls/[id]", "DELETE", { cookie: c, params: { id: aleppoHall } })).status);
    // Not the host and no supervisor right: a Damascus agent cannot act on the Aleppo session or call into its hall.
    const k = cookies["khalid"];
    refused(
      (
        await http("v1/halls/sessions/[id]/actions", "POST", {
          cookie: k,
          params: { id: aleppoSession },
          body: { action: "enter" },
        })
      ).status,
    );
    // Halls are off in Damascus (409); with them on, a hall of another branch is simply not found (400).
    expect(
      (await http("v1/halls/call-group", "POST", { cookie: k, body: { hallId: aleppoHall } })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await db().select().from(hallSessions).where(eq(hallSessions.hallId, aleppoHall))).toHaveLength(1);
    const [h] = await db().select().from(halls).where(eq(halls.id, aleppoHall));
    expect(h.archivedAt).toBeNull();
    expect(h.capacity).toBe(4);
    // The Damascus admin does not see the Aleppo hall in the branch list.
    const list = (await http("v1/admin/branches", "GET", { cookie: c })).json.items;
    expect(JSON.stringify(list)).not.toContain(aleppoHall);
  });

  it("announcements, report schedules, invites, notifications, alerts, groups and rules of another city are untouchable", async () => {
    const c = cookies["damascus.admin"];
    refused((await http("v1/admin/announcements/[id]", "DELETE", { cookie: c, params: { id: aleppoAnnouncement } })).status);
    expect((await db().select().from(announcements).where(eq(announcements.id, aleppoAnnouncement))).length).toBe(1);
    refused((await http("v1/reports/schedules/[id]", "DELETE", { cookie: c, params: { id: aleppoSchedule } })).status);
    refused((await http("v1/reports/schedules/[id]/send", "POST", { cookie: c, params: { id: aleppoSchedule } })).status);
    expect((await db().select().from(reportSchedules).where(eq(reportSchedules.id, aleppoSchedule))).length).toBe(1);
    refused((await http("v1/admin/invites/[id]", "DELETE", { cookie: c, params: { id: aleppoInvite } })).status);
    refused(
      (await http("v1/admin/invites/[id]", "POST", { cookie: c, params: { id: aleppoInvite }, body: { channels: [] } })).status,
    );
    refused((await http("v1/admin/notifications/log/[id]", "POST", { cookie: c, params: { id: aleppoNotification } })).status);
    refused((await http("v1/alerts/[id]/ack", "POST", { cookie: c, params: { id: aleppoAlert } })).status);
    const [al] = await db().select().from(alerts).where(eq(alerts.id, aleppoAlert));
    expect(al.acknowledgedAt).toBeNull();
    const groupRes = await http("v1/admin/groups/[id]", "DELETE", { cookie: c, params: { id: aleppoGroup } });
    refused(groupRes.status);
    const rules = (await http("v1/admin/distribution-rules", "GET", { cookie: c })).json;
    expect(rules.rules.every((r: { branchId: string | null }) => r.branchId !== aleppoBranch)).toBe(true);
  });

  it("settings of another city's branch can be neither written nor cleared", async () => {
    const c = cookies["damascus.admin"];
    refused(
      (
        await http("v1/admin/settings/[key]", "PUT", {
          cookie: c,
          params: { key: "wifi" },
          search: `?branchId=${aleppoBranch}`,
          body: { enabled: true },
        })
      ).status,
    );
    refused(
      (
        await http("v1/admin/settings/[key]", "DELETE", {
          cookie: c,
          params: { key: "wifi" },
          search: `?branchId=${aleppoBranch}`,
        })
      ).status,
    );
  });

  it("issuing coverage and its one-click fix stay inside the admin's city", async () => {
    const c = cookies["damascus.admin"];
    refused(
      (await http("v1/admin/coverage/[branchId]/enable-agent-issuing", "POST", { cookie: c, params: { branchId: aleppoBranch } }))
        .status,
    );
    const cov = (await http("v1/admin/coverage", "GET", { cookie: c })).json.items.map((b: { branchId: string }) => b.branchId);
    expect(cov).toEqual([damascusBranch]);
  });

  it("lists never include another city's records", async () => {
    const c = cookies["damascus.admin"];
    const users_ = (await http("v1/admin/users", "GET", { cookie: c })).json.items.map((u: { id: string }) => u.id);
    expect(users_).not.toContain(faisalId);
    const dispIds = (await http("v1/admin/displays", "GET", { cookie: c })).json.items.map((d: { id: string }) => d.id);
    expect(dispIds).not.toContain(aleppoDisplay);
    const ann = (await http("v1/admin/announcements", "GET", { cookie: c })).json.items.map((a: { id: string }) => a.id);
    expect(ann).not.toContain(aleppoAnnouncement);
    const sch = (await http("v1/reports/schedules", "GET", { cookie: c })).json.items.map((s: { id: string }) => s.id);
    expect(sch).not.toContain(aleppoSchedule);
    const log = (await http("v1/admin/notifications/log", "GET", { cookie: c })).json.items.map((l: { id: string }) => l.id);
    expect(log).not.toContain(aleppoNotification);
    const al = (await http("v1/alerts", "GET", { cookie: c })).json.items.map((a: { id: string }) => a.id);
    expect(al).not.toContain(aleppoAlert);
    const branchesSeen = (await http("v1/admin/branches", "GET", { cookie: c })).json.items.map((b: { id: string }) => b.id);
    expect(branchesSeen).toEqual([damascusBranch]);
    const groups = (await http("v1/admin/groups", "GET", { cookie: c })).json.items.map((g: { id: string }) => g.id);
    expect(groups).not.toContain(aleppoGroup);
    const audit = (await http("v1/admin/audit", "GET", { cookie: c })).json.items as { branchId: string | null }[];
    expect(audit.every((a) => a.branchId !== aleppoBranch)).toBe(true);
    const lookups = (await http("v1/admin/lookups", "GET", { cookie: c })).json;
    expect(lookups.branches.map((b: { id: string }) => b.id)).toEqual([damascusBranch]);
    expect(lookups.agents.map((a: { id: string }) => a.id)).not.toContain(faisalId);
    expect(lookups.cities.map((x: { id: string }) => x.id)).not.toContain(aleppoCity);
  });

  it("reports, forecasts, the wallboard and exports are limited to the viewer's own branches", async () => {
    const c = cookies["damascus.admin"];
    const q = `?from=2026-09-01&to=2026-09-02&branchId=${aleppoBranch}`;
    refused((await http("v1/reports/overview", "GET", { cookie: c, search: q })).status);
    refused((await http("v1/reports/export", "GET", { cookie: c, search: `${q}&format=csv` })).status);
    refused((await http("v1/reports/forecast", "GET", { cookie: c, search: `?branchId=${aleppoBranch}` })).status);
    refused((await http("v1/reports/live", "GET", { cookie: c, search: `?branchId=${aleppoBranch}` })).status);
    refused((await http("v1/admin/wait-analytics", "GET", { cookie: c, search: `?branchId=${aleppoBranch}` })).status);
    const overview = await http("v1/reports/overview", "GET", { cookie: c, search: "?from=2026-09-01&to=2026-09-02" });
    expect(overview.status).toBe(200);
    expect(overview.json.meta.branches.map((b: { id: string }) => b.id)).toEqual([damascusBranch]);
    // Agents of other cities are not offered as filter values either.
    expect(overview.json.meta.agents.map((a: { id: string }) => a.id)).not.toContain(faisalId);
  });

  it("the live queue, reception and appointments of another branch are closed to reception and agents", async () => {
    for (const who of ["reception", "khalid"]) {
      const c = cookies[who];
      refused((await http("v1/queue/state", "GET", { cookie: c, search: `?branchId=${aleppoBranch}` })).status);
    }
    refused(
      (
        await http("v1/queue/appointments", "GET", {
          cookie: cookies["reception"],
          search: `?branchId=${aleppoBranch}&code=ABC123`,
        })
      ).status,
    );
    const ctx = await http("v1/queue/reception", "GET", { cookie: cookies["reception"], search: `?branchId=${aleppoBranch}` });
    // Asking for a branch the receptionist does not work in falls back to their own branch, never the requested one.
    expect(ctx.status).toBe(200);
    expect(ctx.json.branch.id).not.toBe(aleppoBranch);
    refused(
      (
        await http("v1/queue/tickets", "POST", {
          cookie: cookies["reception"],
          body: { branchId: aleppoBranch, reasonId: generalReason, fields: {}, consent: false },
        })
      ).status,
    );
  });

  it("ticket actions on another branch's ticket are refused for staff of a different branch", async () => {
    for (const who of ["reception", "khalid", "damascus.admin"]) {
      for (const body of [
        { action: "cancel" },
        { action: "edit", notes: "x" },
        { action: "hold" },
        { action: "complete" },
        { action: "no_show" },
        { action: "assign", agentId: null },
        { action: "transfer", toAgentId: faisalId },
        { action: "undo" },
        { action: "check_in" },
      ]) {
        const res = await http("v1/queue/tickets/[id]/actions", "POST", {
          cookie: cookies[who],
          params: { id: aleppoTicket },
          body,
        });
        expect([403, 409, 400], `${who} ${body.action} -> ${res.status}`).toContain(res.status);
        expect(res.status === 200, `${who} ${body.action}`).toBe(false);
      }
    }
    expect(true).toBe(true);
  });

  it("reason assignments: a city admin replaces only their own branches' rows and never the organization-wide ones", async () => {
    const [reason] = await db().select().from(visitReasons).where(eq(visitReasons.id, generalReason));
    const before = await db().select().from(reasonAssignments).where(eq(reasonAssignments.reasonId, reason.id));
    const orgWideOrOther = before.filter((a) => a.branchId !== damascusBranch);
    expect(orgWideOrOther.length).toBeGreaterThan(0); // seed has Aleppo (and organization-wide) rows for this reason
    const c = cookies["damascus.admin"];
    // An entry without a branch would be organization-wide: refused.
    const wide = await http("v1/admin/reasons/[id]/assignments", "PUT", {
      cookie: c,
      params: { id: reason.id },
      body: [{ userId: faisalId, proficiency: 3, isPrimary: false }],
    });
    expect(wide.status).toBe(403);
    const other = await http("v1/admin/reasons/[id]/assignments", "PUT", {
      cookie: c,
      params: { id: reason.id },
      body: [{ userId: faisalId, branchId: aleppoBranch, proficiency: 3, isPrimary: false }],
    });
    expect(other.status).toBe(403);
    // Replacing their own branch's rows leaves every other row exactly as it was.
    const mine = await http("v1/admin/reasons/[id]/assignments", "PUT", {
      cookie: c,
      params: { id: reason.id },
      body: [],
    });
    expect(mine.status).toBe(200);
    const after = await db().select().from(reasonAssignments).where(eq(reasonAssignments.reasonId, reason.id));
    expect(
      after
        .filter((a) => a.branchId !== damascusBranch)
        .map((a) => a.id)
        .sort(),
    ).toEqual(orgWideOrOther.map((a) => a.id).sort());
  });

  it("data-subject requests: a visitor who only visited another city is invisible to a city admin", async () => {
    const phoneReason = (await db().select().from(visitReasons)).find((r) => r.intakeFields.some((f) => f.key === "phone"))!;
    const fields = Object.fromEntries(
      phoneReason.intakeFields.map((f) => [
        f.key,
        f.key === "phone" ? "0944111222" : f.key === "national_id_last4" ? "1234" : "Zed Visitor",
      ]),
    );
    const t = await issueTicket(superAdmin, {
      branchId: aleppoBranch,
      reasonId: phoneReason.id,
      language: "ar",
      fields,
      consent: true,
      source: "reception",
    } as never);
    const visitorId = t.ticket.visitor ? (t.ticket as unknown as { visitorId?: string }).visitorId : undefined;
    const [row] = await db()
      .execute<{ visitor_id: string }>(sql`select visitor_id from tickets where id = ${t.ticket.id}`)
      .then((r) => r.rows);
    const id = visitorId ?? row.visitor_id;
    expect(id).toBeTruthy();
    const c = cookies["damascus.admin"];
    refused((await http("v1/admin/privacy/subjects/[id]", "GET", { cookie: c, params: { id } })).status);
    refused(
      (await http("v1/admin/privacy/subjects/[id]/export", "POST", { cookie: c, params: { id }, body: { format: "json" } }))
        .status,
    );
    refused(
      (
        await http("v1/admin/privacy/subjects/[id]/erase", "POST", {
          cookie: c,
          params: { id },
          body: { reason: "cross-city attempt", confirm: true },
        })
      ).status,
    );
    const found = await http("v1/admin/privacy/subjects", "GET", { cookie: c, search: "?q=Zed" });
    expect(found.json.items).toEqual([]);
    // The Aleppo admin does see them.
    const own = await http("v1/admin/privacy/subjects", "GET", { cookie: cookies["aleppo.admin"], search: "?q=Zed" });
    expect(own.json.items.length).toBe(1);
  });

  it("a screen's device token opens only its own kind of door (display vs kiosk)", async () => {
    const mk = async (kind: "display" | "kiosk") => {
      const created = await createDisplay(aleppoAdmin, {
        name: `${kind} dev`,
        branchId: aleppoBranch,
        kind,
        layout: "classic",
        config: {},
      } as never);
      return (await pairDevice(created.pairingCode, { ip: "127.0.0.1", userAgent: "t" }, kind)).token;
    };
    const [displayToken, kioskToken] = [await mk("display"), await mk("kiosk")];
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    expect((await http("v1/kiosk/context", "GET", { headers: auth(displayToken) })).status).toBe(401);
    expect((await http("v1/display/state", "GET", { headers: auth(kioskToken) })).status).toBe(401);
    expect((await http("v1/kiosk/context", "GET", { headers: auth(kioskToken) })).status).toBe(200);
    expect((await http("v1/display/state", "GET", { headers: auth(displayToken) })).status).toBe(200);
    // A kiosk issues tickets only in its own branch, whatever the body says.
    const res = await http("v1/kiosk/tickets", "POST", {
      headers: auth(displayToken),
      body: { reasonId: generalReason, branchId: damascusBranch, language: "ar", fields: {} },
    });
    expect(res.status).toBe(401);
    // A made-up or session cookie is no substitute for the device token.
    expect((await http("v1/kiosk/context", "GET", { cookie: cookies["aleppo.admin"] })).status).toBe(401);
  });

  it("organization-level powers are refused to a city admin", async () => {
    const c = cookies["damascus.admin"];
    for (const [route, method] of [
      ["v1/admin/cities", "POST"],
      ["v1/admin/roles", "POST"],
      ["v1/admin/audio-packs", "POST"],
      ["v1/admin/branding/logo", "POST"],
      ["v1/admin/notifications/test", "POST"],
    ] as const) {
      const res = await http(route, method, { cookie: c, body: {} });
      expect(res.status, `${method} ${route}`).toBe(403);
    }
    // Templates: the organization's own wording is organization-wide; a city may only edit its own overrides.
    const tpl = { channel: "sms", event: "ticket_issued", body: { ar: "x" } };
    expect((await http("v1/admin/templates", "PUT", { cookie: c, body: tpl })).status).toBe(403);
    expect((await http("v1/admin/templates", "PUT", { cookie: c, body: { ...tpl, cityId: aleppoCity } })).status).toBe(403);
    refused(
      (await http("v1/admin/templates", "DELETE", { cookie: c, search: `?cityId=${aleppoCity}&channel=sms&event=ticket_issued` }))
        .status,
    );
    // The organization-wide settings and shifts need the organization-wide grant even though admin.access is held.
    expect((await http("v1/admin/settings/[key]", "PUT", { cookie: c, params: { key: "security" }, body: {} })).status).toBe(403);
    expect(
      (
        await http("v1/admin/shifts", "POST", {
          cookie: c,
          body: { code: "X", name: { ar: "x" }, startsAt: "08:00", endsAt: "16:00" },
        })
      ).status,
    ).toBe(403);
  });

  it("a scoped user cannot grant what they do not hold (no escalation through users or invites)", async () => {
    const c = cookies["damascus.admin"];
    const superRole = (await db().query.roles.findFirst({ where: (r, { eq: e }) => e(r.key, "super_admin") }))!;
    const res = await http("v1/admin/invites", "POST", {
      cookie: c,
      body: { email: "evil@example.com", roleId: superRole.id, branchId: damascusBranch, channels: [], locale: "ar" },
    });
    expect(res.status).toBe(403);
    const orgWide = await http("v1/admin/invites", "POST", {
      cookie: c,
      body: {
        email: "evil2@example.com",
        roleId: (await db().query.roles.findFirst({ where: (r, { eq: e }) => e(r.key, "agent") }))!.id,
        branchId: null,
        channels: [],
        locale: "ar",
      },
    });
    expect(orgWide.status).toBe(403);
  });
});
