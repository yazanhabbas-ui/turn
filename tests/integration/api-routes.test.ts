import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as inviteRoute from "@/app/api/v1/admin/invites/route";
import * as rolesRoute from "@/app/api/v1/admin/roles/route";
import * as settingsKeyRoute from "@/app/api/v1/admin/settings/[key]/route";
import * as usersRoute from "@/app/api/v1/admin/users/route";
import * as loginRoute from "@/app/api/v1/auth/login/route";
import * as publicInviteRoute from "@/app/api/v1/public/invites/[token]/route";
import { db, pool } from "@/db/client";
import { roles } from "@/db/schema";
import { resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const ORIGIN = "http://localhost:3000";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers = new Headers({ host: "localhost:3000", "x-dor-client-ip": "10.0.0.9" });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, ORIGIN), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function call(handler: Handler, req: NextRequest, params: Record<string, string> = {}) {
  const res = await handler(req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json(), cookie: res.headers.get("set-cookie") };
}

async function signIn(email: string) {
  const r = await call(loginRoute.POST as Handler, request("/api/v1/auth/login", { body: { email, password: "Dor@Demo2026" } }));
  expect(r.status).toBe(200);
  return r.cookie!.split(";")[0];
}

describe.runIf(available)("API routes (database)", () => {
  beforeEach(async () => {
    await resetDemo();
  });
  afterAll(async () => {
    await pool().end();
  });

  it("rejects cross-origin and origin-less mutations (CSRF)", async () => {
    const cookie = await signIn("admin@dor.local");
    const evil = await call(
      rolesRoute.POST as Handler,
      request("/api/v1/admin/roles", { body: {}, cookie, origin: "https://evil.example" }),
    );
    expect(evil).toMatchObject({ status: 403, json: { error: { code: "bad_origin" } } });
    const none = await call(rolesRoute.POST as Handler, request("/api/v1/admin/roles", { body: {}, cookie, origin: null }));
    expect(none.status).toBe(403);
  });

  it("requires a session and the right permission", async () => {
    expect((await call(usersRoute.GET as Handler, request("/api/v1/admin/users"))).status).toBe(401);
    const agentCookie = await signIn("khalid@dor.local");
    const forbidden = await call(usersRoute.GET as Handler, request("/api/v1/admin/users", { cookie: agentCookie }));
    expect(forbidden).toMatchObject({ status: 403, json: { error: { code: "forbidden" } } });
    const adminCookie = await signIn("admin@dor.local");
    const ok = await call(
      usersRoute.GET as Handler,
      request("/api/v1/admin/users?q=%D8%B3%D8%A7%D8%B1%D8%A9", { cookie: adminCookie }),
    );
    expect(ok.status).toBe(200);
    expect(ok.json.items.map((u: { email: string }) => u.email)).toEqual(["sara@dor.local"]);
  });

  it("returns structured validation errors", async () => {
    const cookie = await signIn("admin@dor.local");
    const bad = await call(
      settingsKeyRoute.PUT as Handler,
      request("/api/v1/admin/settings/privacy", { method: "PUT", body: { retentionDays: "soon" }, cookie }),
      { key: "privacy" },
    );
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("validation");
  });

  it("invite link → public accept → signed in with the preselected role", async () => {
    const cookie = await signIn("admin@dor.local");
    const [agentRole] = await db().select().from(roles).where(eq(roles.key, "agent"));
    const created = await call(
      inviteRoute.POST as Handler,
      request("/api/v1/admin/invites", {
        body: { email: "rana@dor.local", roleId: agentRole.id, branchId: null, channels: [], locale: "ar" },
        cookie,
      }),
    );
    expect(created.json).toMatchObject({ link: expect.any(String) });
    const token = created.json.link.split("/").pop();

    const info = await call(publicInviteRoute.GET as Handler, request(`/api/v1/public/invites/${token}`), { token });
    expect(info.json.email).toBe("rana@dor.local");

    const accepted = await call(
      publicInviteRoute.POST as Handler,
      request(`/api/v1/public/invites/${token}`, { body: { displayName: { ar: "رنا" }, password: "Aleppo-Office-88" } }),
      { token },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.cookie).toMatch(/dor_session=[a-z0-9]+; .*HttpOnly/i);

    const again = await call(publicInviteRoute.GET as Handler, request(`/api/v1/public/invites/${token}`), { token });
    expect(again.status).toBe(404);
  });
});
