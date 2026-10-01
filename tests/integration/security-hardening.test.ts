import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { generateTOTP } from "@oslojs/otp";
import { and, eq } from "drizzle-orm";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, branches, displays, floors, users, visitors } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { createDesk } from "@/server/admin/branches";
import { createDisplay } from "@/server/admin/screens";
import { audit } from "@/server/audit";
import {
  TOTP_MAX_FAILURES,
  beginTotpSetup,
  confirmTotpSetup,
  disableTotp,
  login,
  verifySecondFactor,
} from "@/server/auth/service";
import { invalidateUserSessions, validateSessionToken } from "@/server/auth/session";
import { decryptTotpSecret } from "@/server/auth/totp";
import { decryptWithKey, encryptWithKey, hashPhoneWithKey, parseEncryptionKey } from "@/server/crypto";
import { pairDevice } from "@/server/display/device";
import { rotateEncryptionKey, rotatePhoneHashKey } from "@/server/security/rotate-keys";
import { AppError } from "@/server/http/errors";
import { initRealtime, io } from "@/server/realtime";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();
const PASSWORD = "Dor@Demo2026";
const client = { ip: "127.0.0.1", userAgent: "vitest" };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

afterAll(async () => {
  if (available) await pool().end();
});

const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe.runIf(available)("sign-in hardening (database)", () => {
  beforeEach(async () => {
    await resetDemo();
  });
  it("a locked account answers like an unknown one unless the right password is given", async () => {
    for (let i = 0; i < 5; i++) await login({ email: "khalid@dor.local", password: "nope" }, client).catch(() => undefined);
    // The lock cannot be used to find out that the address has an account.
    await expectCode(login({ email: "khalid@dor.local", password: "still wrong" }, client), "invalid_credentials");
    await expectCode(login({ email: "ghost@dor.local", password: "still wrong" }, client), "invalid_credentials");
    // Whoever knows the password is told.
    await expectCode(login({ email: "khalid@dor.local", password: PASSWORD }, client), "account_locked");
  });

  async function enrol() {
    const first = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    const auth = (await validateSessionToken(first.token))!;
    await beginTotpSetup(auth);
    const [u] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    const secret = decryptTotpSecret(u.totpSecretEnc!);
    await confirmTotpSetup(auth, generateTOTP(secret, 30, 6), client);
    return { first, auth, secret };
  }

  it("enabling and disabling 2FA ends the user's other sessions but keeps the current one", async () => {
    const other = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    const first = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    const auth = (await validateSessionToken(first.token))!;
    await beginTotpSetup(auth);
    const [u] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    await confirmTotpSetup(auth, generateTOTP(decryptTotpSecret(u.totpSecretEnc!), 30, 6), client);
    expect(await validateSessionToken(other.token)).toBeNull();
    expect(await validateSessionToken(first.token)).not.toBeNull();

    const second = await login({ email: "khalid@dor.local", password: PASSWORD }, client); // pending 2FA session
    await disableTotp(auth, PASSWORD, client);
    expect(await validateSessionToken(second.token)).toBeNull();
    expect(await validateSessionToken(first.token)).not.toBeNull();
  });

  it("a one-time code cannot sign in twice", async () => {
    const { secret } = await enrol();
    const code = generateTOTP(secret, 30, 6);
    const a = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    await verifySecondFactor((await validateSessionToken(a.token))!, code, client);
    const b = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    await expectCode(verifySecondFactor((await validateSessionToken(b.token))!, code, client), "invalid_code");
    expect((await validateSessionToken(b.token))!.twoFactorVerified).toBe(false);
  });

  it("repeated wrong codes cancel the pending sign-in", async () => {
    const { secret } = await enrol();
    const pending = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    const auth = (await validateSessionToken(pending.token))!;
    const bad = wrong(generateTOTP(secret, 30, 6));
    for (let i = 0; i < TOTP_MAX_FAILURES; i++) await expectCode(verifySecondFactor(auth, bad, client), "invalid_code");
    await expectCode(verifySecondFactor(auth, bad, client), "rate_limited");
    // The session is gone: the password has to be entered again, and even the right code no longer helps.
    expect(await validateSessionToken(pending.token)).toBeNull();
    const [row] = await db().select().from(auditLogs).where(eq(auditLogs.action, "auth.totp_locked"));
    expect(row).toBeTruthy();
  });
});

describe.runIf(available)("data integrity and audit hygiene (database)", () => {
  beforeEach(async () => {
    await resetDemo();
  });

  it("a desk can only sit on a floor of its own branch", async () => {
    const admin = await actorFor("admin@dor.local");
    const bs = await db().select().from(branches);
    const dam = bs.find((b) => b.code === "DAM-01")!;
    const alp = bs.find((b) => b.code === "ALP-01")!;
    const [aleppoFloor] = await db()
      .insert(floors)
      .values({ organizationId: admin.auth.user.organizationId, branchId: alp.id, name: { ar: "طابق" } })
      .returning();
    await expectCode(
      createDesk(admin, dam.id, { number: "42", name: { ar: "مكتب" }, floorId: aleppoFloor.id, sortOrder: 0 }),
      "validation",
    );
    const own = await createDesk(admin, alp.id, { number: "42", name: { ar: "مكتب" }, floorId: aleppoFloor.id, sortOrder: 0 });
    expect(own.id).toBeTruthy();
  });

  it("the audit trail never stores secrets, pairing codes or tokens", async () => {
    const admin = await actorFor("admin@dor.local");
    await audit({
      organizationId: admin.auth.user.organizationId,
      action: "test.secret",
      entityType: "x",
      before: { passwordHash: "h", totpSecretEnc: "t", pairingCode: "ABC123", keep: 1 },
      after: { nested: { token: "t", password: "p", tokenHash: "h", ok: true } },
    });
    const [row] = await db().select().from(auditLogs).where(eq(auditLogs.action, "test.secret"));
    expect(JSON.stringify(row.before) + JSON.stringify(row.after)).not.toMatch(
      /passwordHash|totpSecretEnc|pairingCode|tokenHash|"password"|"token"/,
    );
    expect(row.before).toEqual({ keep: 1 });
    expect(row.after).toEqual({ nested: { ok: true } });
  });
});

describe.runIf(available)("key rotation (database)", () => {
  beforeEach(async () => {
    await resetDemo();
  });

  it("re-encrypts 2FA secrets under a new key and refuses a wrong old key without changing anything", async () => {
    const first = await login({ email: "khalid@dor.local", password: PASSWORD }, client);
    const auth = (await validateSessionToken(first.token))!;
    await beginTotpSetup(auth);
    const [before] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    const secret = decryptTotpSecret(before.totpSecretEnc!);
    const current = process.env.APP_ENCRYPTION_KEY!;
    const next = Buffer.alloc(32, 42).toString("base64");

    await expect(rotateEncryptionKey(Buffer.alloc(32, 1).toString("base64"), next)).rejects.toThrow();
    const [unchanged] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    expect(unchanged.totpSecretEnc).toBe(before.totpSecretEnc);

    expect(await rotateEncryptionKey(current, next)).toEqual({ users: 1 });
    const [after] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    expect(after.totpSecretEnc).not.toBe(before.totpSecretEnc);
    expect(Buffer.from(decryptWithKey(parseEncryptionKey(next), after.totpSecretEnc!))).toEqual(Buffer.from(secret));
    expect(() => decryptTotpSecret(after.totpSecretEnc!)).toThrow(); // the old key no longer opens it
  });

  it("rehashes visitor phone numbers under a new key and leaves foreign hashes alone", async () => {
    const admin = await actorFor("admin@dor.local");
    const org = admin.auth.user.organizationId;
    const oldKey = process.env.PHONE_HASH_KEY!;
    const [ok] = await db()
      .insert(visitors)
      .values({ organizationId: org, phone: "963944111222", phoneHash: hashPhoneWithKey(oldKey, "963944111222") })
      .returning();
    const [odd] = await db()
      .insert(visitors)
      .values({ organizationId: org, phone: "963944333444", phoneHash: "not-from-the-old-key" })
      .returning();
    const result = await rotatePhoneHashKey(oldKey, "brand-new-phone-hash-key-123456");
    expect(result).toEqual({ rehashed: 1, unmatched: 1 });
    const rows = await db().select().from(visitors);
    expect(rows.find((r) => r.id === ok.id)!.phoneHash).toBe(hashPhoneWithKey("brand-new-phone-hash-key-123456", "963944111222"));
    expect(rows.find((r) => r.id === odd.id)!.phoneHash).toBe("not-from-the-old-key");
  });

  it("every encryption uses a fresh nonce", () => {
    const key = parseEncryptionKey(Buffer.alloc(32, 5).toString("base64"));
    const seen = new Set(Array.from({ length: 200 }, () => encryptWithKey(key, "same").slice(0, 16)));
    expect(seen.size).toBe(200);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe.runIf(available)("realtime hub (database)", () => {
  let server: HttpServer;
  let url: string;
  const sockets: Socket[] = [];
  let damascus: string;
  let aleppo: string;
  let admin: Actor;

  const open = (opts: { cookie?: string; origin?: string; deviceToken?: string } = {}) => {
    const s = connect(url, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      extraHeaders: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.origin ? { origin: opts.origin } : {}) },
      auth: opts.deviceToken ? { deviceToken: opts.deviceToken } : undefined,
    });
    sockets.push(s);
    return s;
  };
  const connected = (s: Socket) =>
    new Promise<"connected" | string>((resolve) => {
      s.on("connect", () => resolve("connected"));
      s.on("connect_error", (e) => resolve(e.message));
    });
  const subscribe = (s: Socket, branchId: unknown) =>
    new Promise<{ ok: boolean }>((resolve) => s.emit("subscribe", { branchId }, resolve));
  const cookieFor = async (email: string) => `dor_session=${(await login({ email, password: PASSWORD }, client)).token}`;

  beforeEach(async () => {
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    const bs = await db().select().from(branches);
    damascus = bs.find((b) => b.code === "DAM-01")!.id;
    aleppo = bs.find((b) => b.code === "ALP-01")!.id;
    if (!server) {
      server = createServer();
      initRealtime(server);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(() => {
    for (const s of sockets) s.close();
    io()?.close();
  });

  it("refuses sockets without a session and sockets opened from another site", async () => {
    expect(await connected(open())).toBe("unauthorized");
    const cookie = await cookieFor("khalid@dor.local");
    expect(await connected(open({ cookie, origin: "https://evil.example" }))).not.toBe("connected");
    expect(await connected(open({ cookie }))).toBe("connected");
  });

  it("only joins branch rooms the user may see, and never one of another city", async () => {
    const s = open({ cookie: await cookieFor("khalid@dor.local") });
    expect(await connected(s)).toBe("connected");
    expect(await subscribe(s, damascus)).toEqual({ ok: true });
    expect(await subscribe(s, aleppo)).toEqual({ ok: false });
    expect(await subscribe(s, "not-a-uuid")).toEqual({ ok: false });
    expect(await subscribe(s, { $ne: 1 })).toEqual({ ok: false });
    const rooms = (await io()!.fetchSockets()).find((x) => x.id === s.id)!.rooms;
    expect(rooms.has(`branch:${damascus}`)).toBe(true);
    expect(rooms.has(`branch:${aleppo}`)).toBe(false);
  });

  it("a waiting-room screen can never join staff rooms, only its own branch's screen room", async () => {
    const created = await createDisplay(admin, {
      name: "TV",
      branchId: damascus,
      kind: "display",
      layout: "classic",
      config: {},
    } as never);
    const { token } = await pairDevice(created.pairingCode, { ip: "127.0.0.1", userAgent: "tv" });
    const s = open({ deviceToken: token });
    expect(await connected(s)).toBe("connected");
    s.emit("subscribe", { branchId: damascus });
    await new Promise((r) => setTimeout(r, 150));
    const rooms = [...(await io()!.fetchSockets()).find((x) => x.id === s.id)!.rooms];
    expect(rooms.some((r) => r.startsWith("branch:") || r.startsWith("org:") || r.startsWith("user:"))).toBe(false);
    expect(rooms).toContain(`screens:${damascus}`);
    expect(rooms).not.toContain(`screens:${aleppo}`);
    expect(await connected(open({ deviceToken: "x".repeat(40) }))).toBe("unauthorized");
  });

  it("revoking a screen or ending a user's sessions drops their sockets at once", async () => {
    const s = open({ cookie: await cookieFor("khalid@dor.local") });
    await connected(s);
    const gone = new Promise<string>((r) => s.on("disconnect", r));
    const [khalid] = await db().select().from(users).where(eq(users.email, "khalid@dor.local"));
    await invalidateUserSessions(khalid.id);
    expect(await gone).toBe("io server disconnect");

    const created = await createDisplay(admin, {
      name: "TV2",
      branchId: damascus,
      kind: "display",
      layout: "classic",
      config: {},
    } as never);
    const { token } = await pairDevice(created.pairingCode, { ip: "127.0.0.1", userAgent: "tv" });
    const tv = open({ deviceToken: token });
    await connected(tv);
    const tvGone = new Promise<string>((r) => tv.on("disconnect", r));
    const { revokeDisplay } = await import("@/server/admin/screens");
    await revokeDisplay(admin, created.id);
    expect(await tvGone).toBe("io server disconnect");
    const [d] = await db()
      .select()
      .from(displays)
      .where(and(eq(displays.id, created.id)));
    expect(d.tokenHash).toBeNull();
  });

  it("drops a client that sends an oversized message", async () => {
    const s = open({ cookie: await cookieFor("khalid@dor.local") });
    await connected(s);
    const gone = new Promise<string>((r) => s.on("disconnect", r));
    s.emit("subscribe", { branchId: "x".repeat(64 * 1024) });
    expect(await gone).toMatch(/close|disconnect/);
  });
});
