import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deepMerge as distributionMerge } from "@/domain/distribution/config";
import { API_CSP, buildPageCsp, newNonce } from "@/lib/csp";
import { safeNext } from "@/lib/safe-next";
import { announcementInput } from "@/server/admin/screens";
import { originAllowed, handshakeIp } from "@/server/realtime";
import { clientIp, route } from "@/server/http/route";
import { renderCsv, renderXlsx } from "@/server/reports/export";
import type { ExportDoc } from "@/server/reports/export-doc";
import { securityFindings, assertSecureConfiguration } from "@/server/security/startup";
import { SETTINGS } from "@/server/settings/registry";

const DEV_ENC = "ZG9yLWRldi1vbmx5LWtleS1jaGFuZ2UtbWUtcGxlYXM=";
const GOOD_ENC = Buffer.alloc(32, 9).toString("base64");

describe("startup security check", () => {
  const base = {
    NODE_ENV: "production",
    APP_URL: "https://queue.example.com",
    APP_ENCRYPTION_KEY: GOOD_ENC,
    PHONE_HASH_KEY: "a-long-random-phone-key-0123456789",
    TRUST_PROXY: true,
  };

  it("does nothing outside production", () => {
    expect(securityFindings({ ...base, NODE_ENV: "development", APP_ENCRYPTION_KEY: DEV_ENC }, {})).toEqual([]);
  });

  it("refuses the well-known keys on an https installation", () => {
    const f = securityFindings({ ...base, APP_ENCRYPTION_KEY: DEV_ENC, PHONE_HASH_KEY: "dor-dev-only-phone-hash-key" }, {});
    expect(f.filter((x) => x.level === "error").map((x) => x.code)).toEqual(["default_encryption_key", "default_phone_hash_key"]);
    expect(() => assertSecureConfiguration({ ...base, APP_ENCRYPTION_KEY: DEV_ENC }, {})).toThrow(/Refusing to start/);
  });

  it("refuses them when the demo data is off, even on plain http (a real installation)", () => {
    const cfg = { ...base, APP_URL: "http://10.0.0.5:3000", APP_ENCRYPTION_KEY: DEV_ENC };
    expect(securityFindings(cfg, { SEED_DEMO: "false" }).some((x) => x.level === "error")).toBe(true);
    expect(securityFindings(cfg, {}).some((x) => x.level === "error")).toBe(true);
  });

  it("only warns for a plain-http demo, so `docker compose up` still starts", () => {
    const cfg = {
      ...base,
      APP_URL: "http://localhost:3000",
      APP_ENCRYPTION_KEY: DEV_ENC,
      PHONE_HASH_KEY: "dor-dev-only-phone-hash-key",
    };
    const f = securityFindings(cfg, { SEED_DEMO: "true" });
    expect(f.some((x) => x.level === "error")).toBe(false);
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(["default_encryption_key", "demo_password", "plain_http"]));
    expect(() => assertSecureConfiguration(cfg, { SEED_DEMO: "true" })).not.toThrow();
  });

  it("is quiet for a properly configured https installation", () => {
    expect(securityFindings(base, { SEED_DEMO: "false" })).toEqual([]);
  });

  it("warns about a default database password and an insecure cookie override on https", () => {
    const f = securityFindings(
      { ...base, DATABASE_URL: "postgres://dor:dor@db:5432/dor", COOKIE_SECURE: "false" },
      { SEED_DEMO: "false" },
    ).map((x) => x.code);
    expect(f).toEqual(["cookie_not_secure", "default_database_password"]);
    expect(securityFindings({ ...base, DATABASE_URL: "postgres://dor:k3j2h4g5k2j3h4g@db/dor" }, { SEED_DEMO: "false" })).toEqual(
      [],
    );
  });

  it("warns when https is used without trusting the proxy", () => {
    expect(securityFindings({ ...base, TRUST_PROXY: false }, { SEED_DEMO: "false" }).map((x) => x.code)).toEqual([
      "proxy_not_trusted",
    ]);
  });
});

describe("Content-Security-Policy", () => {
  it("allows scripts only with the nonce and nothing from other sites", () => {
    const csp = buildPageCsp({ nonce: "abc123", host: "queue.local:3000" });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).toContain("connect-src 'self' ws://queue.local:3000 wss://queue.local:3000");
    expect(csp).not.toMatch(/\bws:(?!\/\/)/);
    for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"])
      expect(csp).toContain(d);
    expect(csp).not.toMatch(/https?:\/\/(?!queue)/);
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("only allows eval in development, and upgrades requests over https", () => {
    expect(buildPageCsp({ nonce: "n", dev: true })).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(buildPageCsp({ nonce: "n", https: true })).toContain("upgrade-insecure-requests");
  });

  it("ignores a hostile Host header instead of putting it in the policy", () => {
    expect(buildPageCsp({ nonce: "n", host: "x; script-src *" })).not.toContain("script-src *");
  });

  it("nonces are unique and unguessable-looking; API responses allow nothing", () => {
    const set = new Set(Array.from({ length: 50 }, newNonce));
    expect(set.size).toBe(50);
    expect([...set][0].length).toBeGreaterThanOrEqual(22);
    expect(API_CSP).toContain("default-src 'none'");
  });
});

describe("client address behind a proxy", () => {
  const req = (xff: string | null) =>
    new NextRequest("http://localhost:3000/api/x", {
      headers: { ...(xff ? { "x-forwarded-for": xff } : {}), "x-dor-client-ip": "10.0.0.1" },
    });

  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    expect(clientIp(req("1.2.3.4"))).toBe("10.0.0.1");
  });

  it("takes the entry the trusted proxy appended, not the one the client wrote", async () => {
    process.env.TRUST_PROXY = "true";
    // env() caches, so read the parsing through a fresh module instance.
    const vitest = await import("vitest");
    vitest.vi.resetModules();
    const { clientIp: fresh } = await import("@/server/http/route");
    // A client sends "6.6.6.6"; the proxy appends the address it actually saw ("203.0.113.9").
    expect(fresh(req("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(fresh(req("203.0.113.9"))).toBe("203.0.113.9");
    expect(fresh(req(null))).toBe("10.0.0.1");
    delete process.env.TRUST_PROXY;
    vitest.vi.resetModules();
  });
});

describe("realtime handshake guards", () => {
  it("accepts same-site and origin-less handshakes, refuses cross-site ones", () => {
    expect(originAllowed(undefined, "localhost:3000")).toBe(true);
    expect(originAllowed("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(originAllowed("https://evil.example", "localhost:3000")).toBe(false);
    expect(originAllowed("null", "localhost:3000")).toBe(false);
    expect(originAllowed("http://localhost:3000.evil.example", "localhost:3000")).toBe(false);
  });

  it("uses the socket address unless the proxy is trusted", () => {
    expect(handshakeIp({ "x-forwarded-for": "6.6.6.6" }, "10.1.1.1")).toBe("10.1.1.1");
    expect(handshakeIp({}, undefined)).toBe("unknown");
  });
});

describe("request body limit", () => {
  const handler = route(
    { auth: "public", body: z.object({ a: z.string().optional() }), maxBodyBytes: 100 },
    async ({ body }) => ({
      ok: true,
      body,
    }),
  );
  const call = (body: string, headers: Record<string, string> = {}) =>
    handler(
      new NextRequest("http://localhost:3000/api/x", {
        method: "POST",
        headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json", ...headers },
        body,
      }),
      { params: Promise.resolve({}) },
    );

  it("accepts a small body", async () => {
    const res = await call('{"a":"b"}');
    expect(res.status).toBe(200);
  });

  it("refuses an oversized body with 413, by length and while reading", async () => {
    const big = JSON.stringify({ a: "x".repeat(500) });
    const res = await call(big);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("validation");
    // A client that lies about the length is still stopped while the body is read.
    const lied = await call(big, { "content-length": "10" });
    expect(lied.status).toBe(413);
  });

  it("reports malformed JSON as a validation error", async () => {
    const res = await call("{nope");
    expect(res.status).toBe(400);
  });

  it("refuses requests the browser marks as cross-site", async () => {
    const res = await call('{"a":"b"}', { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });
});

describe("prototype pollution", () => {
  it("never lets __proto__ reach the prototype when layers are merged", () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"mode":"push"}');
    const out = distributionMerge({ mode: "pull" }, evil) as Record<string, unknown>;
    expect(out.mode).toBe("push");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, "constructor")).toBe(false);
  });
});

describe("local-only media and logos", () => {
  const ann = (mediaUrl: string) =>
    announcementInput.safeParse({ kind: "slide", body: { ar: "x" }, mediaUrl, durationSeconds: 10, sortOrder: 0, isActive: true })
      .success;

  it("slides accept local paths and inline images only", () => {
    expect(ann("/uploads/a.png")).toBe(true);
    expect(ann("data:image/png;base64,AAAA")).toBe(true);
    expect(ann("https://evil.example/a.png")).toBe(false);
    expect(ann("//evil.example/a.png")).toBe(false);
    expect(ann("/\\evil.example/a.png")).toBe(false);
    expect(ann("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(ann("javascript:alert(1)")).toBe(false);
  });

  it("branding logos are never another site or svg; a legacy bad value is dropped, not fatal", () => {
    const parse = (logoUrl: unknown) => SETTINGS.branding.parse({ logoUrl, primaryColor: "#112233" });
    expect(parse("/api/v1/public/branding/logo?v=2").logoUrl).toBe("/api/v1/public/branding/logo?v=2");
    expect(parse("https://cdn.example/logo.png").logoUrl).toBeNull();
    expect(parse("//cdn.example/logo.png").logoUrl).toBeNull();
    expect(parse("data:image/svg+xml;base64,AAAA").logoUrl).toBeNull();
    expect(parse("https://cdn.example/logo.png").primaryColor).toBe("#112233");
  });
});

describe("open redirect after login", () => {
  it("only follows same-site paths", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil",
      "",
      null,
      undefined,
    ])
      expect(safeNext(bad as string | null)).toBe("/");
    expect(safeNext("/admin/users?x=1")).toBe("/admin/users?x=1");
  });
});

describe("spreadsheet formula injection", () => {
  const hostile = ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1"];
  const doc: ExportDoc = {
    locale: "en",
    rtl: false,
    title: "=Title",
    meta: [["Period", "+1"]],
    filtersTitle: "Filters",
    filters: [["Agent", "@evil"]],
    tables: [
      {
        id: "t",
        title: "Visitors",
        columns: ["Name", "Notes"],
        kinds: ["text", "text"],
        rows: hostile.map((h) => [h, `ok ${h}`]),
      },
    ],
    footer: () => "",
  } as never;

  it("every CSV cell that starts like a formula is neutralised (reports and the agent report share this writer)", () => {
    const text = renderCsv(doc).toString("utf8");
    const cells = text.split(/\r\n/).flatMap((l) => l.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g) ?? []);
    for (const raw of cells) {
      const cell = raw.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"');
      expect(cell, JSON.stringify(cell)).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(text).toContain("'=HYPERLINK");
  });

  it("Excel cells holding hostile text are plain strings, never formulas", async () => {
    const buf = await renderXlsx(doc);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    let seen = 0;
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.type === ExcelJS.ValueType.Formula, String(cell.value)).toBe(false);
          if (typeof cell.value === "string" && /^[=+\-@]/.test(cell.value)) seen++;
        }),
      ),
    );
    expect(seen).toBeGreaterThan(0);
  });
});
