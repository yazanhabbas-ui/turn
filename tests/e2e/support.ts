import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PASSWORD = "Dor@Demo2026";
export const BASE = () => process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3200}`;

// ─── Messages: locators use the shipped wording, so a text change in messages/*.json never breaks a test ──────────

type Messages = Record<string, unknown>;
const cache = new Map<string, Messages>();

function load(locale: "ar" | "en"): Messages {
  let m = cache.get(locale);
  if (!m) {
    m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", `${locale}.json`), "utf8")) as Messages;
    cache.set(locale, m);
  }
  return m;
}

/** `msg("ar")("agent.callNext")`; `{name}` placeholders are filled from the second argument. Plain strings only (no ICU plurals). */
export function msg(locale: "ar" | "en" = "ar") {
  return (key: string, params: Record<string, string | number> = {}): string => {
    let cur: unknown = load(locale);
    for (const part of key.split(".")) cur = (cur as Messages | undefined)?.[part];
    if (typeof cur !== "string") throw new Error(`no message ${locale}:${key}`);
    return cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  };
}
export const ar = msg("ar");
export const en = msg("en");

// ─── API client (cookie session, same-origin header) ──────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export class Api {
  private constructor(
    readonly email: string,
    private cookie: string,
  ) {}

  /** The session cookies as {name, value} pairs, to seed a browser context without another login. */
  cookies() {
    return this.cookie.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
  }

  static async login(email: string, password = PASSWORD): Promise<Api> {
    const res = await fetch(`${BASE()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE() },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return new Api(email, cookie);
  }

  async call<T = any>(method: string, url: string, body?: unknown, expectStatus?: number): Promise<T> {
    const res = await fetch(`${BASE()}${url}`, {
      method,
      headers: { "content-type": "application/json", origin: BASE(), cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (expectStatus ? res.status !== expectStatus : !res.ok) {
      throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
  get = <T = any>(url: string) => this.call<T>("GET", url);
  post = <T = any>(url: string, body: unknown = {}) => this.call<T>("POST", url, body);
  put = <T = any>(url: string, body: unknown) => this.call<T>("PUT", url, body);
}

/** An API session cache: one login per account per run. */
const sessions = new Map<string, Promise<Api>>();
export function as(email: string): Promise<Api> {
  let s = sessions.get(email);
  if (!s) sessions.set(email, (s = Api.login(email)));
  return s;
}

export const ACCOUNTS = {
  admin: "admin@dor.local",
  damascusAdmin: "damascus.admin@dor.local",
  aleppoAdmin: "aleppo.admin@dor.local",
  supervisor: "supervisor@dor.local",
  reception: "reception@dor.local",
  khalid: "khalid@dor.local",
  noura: "noura@dor.local",
  mohammed: "mohammed@dor.local",
} as const;

export type Facts = {
  branchId: string;
  aleppoBranchId: string;
  aleppoCityId: string;
  reason: Record<string, string>;
  userIds: Record<string, string>;
};

let factsPromise: Promise<Facts> | undefined;
/** Ids the scenarios need, read once through the API. */
export function facts(): Promise<Facts> {
  factsPromise ??= (async () => {
    const reception = await as(ACCOUNTS.reception);
    const ctx = await reception.get("/api/v1/queue/reception");
    const reason: Record<string, string> = {};
    for (const r of ctx.reasons) reason[r.code] = r.id;
    const admin = await as(ACCOUNTS.admin);
    const lookups = await admin.get("/api/v1/admin/lookups");
    const aleppo = lookups.branches.find((b: any) => b.code === "ALP-01");
    const users = await admin.get("/api/v1/admin/users");
    const userIds: Record<string, string> = {};
    for (const u of users.items) userIds[u.email] = u.id;
    return { branchId: ctx.branch.id, aleppoBranchId: aleppo?.id, aleppoCityId: aleppo?.cityId, reason, userIds };
  })();
  return factsPromise;
}

/**
 * Brings the queue back to an empty, quiet state so a scenario does not depend on the ones before it: open tickets
 * are cancelled and the agents sign out.
 */
export async function cleanSlate() {
  const { branchId } = await facts();
  const admin = await as(ACCOUNTS.admin);
  // Evening agents are off shift for part of the day; the scenarios must not depend on the time of day.
  const settings = await admin.get("/api/v1/admin/settings");
  if (settings.agentWork.shiftMode !== "off")
    await admin.put("/api/v1/admin/settings/agentWork", { ...settings.agentWork, shiftMode: "off" });
  const state = await admin.get(`/api/v1/queue/state?branchId=${branchId}`);
  for (const t of state.tickets) {
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(t.status)) continue;
    await admin.post(`/api/v1/queue/tickets/${t.id}/actions`, { action: "cancel", note: "e2e cleanup" }).catch(() => undefined);
  }
  for (const email of [ACCOUNTS.khalid, ACCOUNTS.noura, ACCOUNTS.mohammed]) {
    const agent = await as(email);
    await agent.post("/api/v1/queue/agent/status", { status: "OFFLINE" }).catch(() => undefined);
  }
}

export type Issued = {
  ticket: { id: string; displayNumber: string; publicToken: string; status: string };
  ahead: number;
  estimatedWaitMinutes: number;
};

export async function issueTicket(reasonCode: string, extra: Record<string, unknown> = {}): Promise<Issued> {
  const { branchId, reason } = await facts();
  const reception = await as(ACCOUNTS.reception);
  return reception.post("/api/v1/queue/tickets", {
    branchId,
    reasonId: reason[reasonCode],
    language: "ar",
    fields: {},
    consent: false,
    source: "reception",
    ...extra,
  });
}

export async function ticketState(id: string) {
  const { branchId } = await facts();
  const admin = await as(ACCOUNTS.admin);
  const state = await admin.get(`/api/v1/queue/state?branchId=${branchId}`);
  return state.tickets.find((t: any) => t.id === id) as
    | {
        id: string;
        displayNumber: string;
        status: string;
        servingAgentId: string | null;
        assignedAgentId: string | null;
        deskId: string | null;
      }
    | undefined;
}

// ─── Browser sessions ─────────────────────────────────────────────────────────────────────────────────────────────

/** A browser context signed in as `email` (the cookie comes from the API login). */
export async function signedIn(
  browser: Browser,
  email: string,
  opts: { locale?: "ar" | "en"; colorScheme?: "light" | "dark" } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE(),
    locale: opts.locale ?? "ar",
    colorScheme: opts.colorScheme ?? "light",
    viewport: { width: 1366, height: 900 },
  });
  // The shared API session (one login per account per run; the login endpoint allows 20 per minute per address).
  const api = await as(email);
  await context.addCookies(api.cookies().map((c) => ({ ...c, url: BASE() })));
  const page = await context.newPage();
  return { context, page };
}

/** Collects uncaught page errors (hydration problems, exceptions in our own code) so a test can assert there were none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** A tiny valid PNG (2x2 teal), generated here so that no binary fixture is committed. */
export function tinyPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const w = 2;
  const h = 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [15, 118, 110, 255]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
