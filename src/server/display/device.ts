import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { displays } from "@/db/schema";
import { audit } from "../audit";
import { randomCode, randomToken, sha256Hex } from "../crypto";
import { AppError } from "../http/errors";
import { rateLimit } from "../rate-limit";
import { io } from "../realtime";

export type DisplayRow = typeof displays.$inferSelect;

export const PAIRING_MINUTES = 15;
const TOUCH_INTERVAL_MS = 20_000;

/** A short code the admin types on the TV; single use, expires quickly. */
export async function issuePairingCode(displayId: string): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
  for (let attempt = 0; ; attempt++) {
    const code = randomCode(6);
    try {
      await db().update(displays).set({ pairingCode: code, pairingExpiresAt: expiresAt }).where(eq(displays.id, displayId));
      return { code, expiresAt };
    } catch (err) {
      // Unique index collision with another pending code: try a new one.
      if (attempt >= 4) throw err;
    }
  }
}

/**
 * Exchanges a pairing code for a long-lived device token (shown once; only its hash is stored). A device that
 * pairs again gets a new token and the previous one stops working.
 */
export async function pairDevice(
  rawCode: string,
  meta: { ip: string; userAgent: string | null },
  kind: "display" | "kiosk" = "display",
) {
  // Pairing is rare. Besides the per-address limit on the route, a global ceiling stops a spread-out guessing run
  // (a pairing code is 6 characters from a 31-letter alphabet and lives 15 minutes).
  if (!(await rateLimit("display-pair-global", 120, 60_000)).ok) throw new AppError("rate_limited");
  const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  const [d] = await db()
    .select()
    .from(displays)
    .where(
      and(
        eq(displays.pairingCode, code),
        eq(displays.kind, kind),
        gt(displays.pairingExpiresAt, new Date()),
        isNull(displays.archivedAt),
      ),
    );
  if (!d) throw new AppError("not_found", { reason: "invalid_pairing_code" });
  const token = randomToken(32);
  await db()
    .update(displays)
    .set({
      tokenHash: sha256Hex(token),
      pairingCode: null,
      pairingExpiresAt: null,
      pairedAt: new Date(),
      revokedAt: null,
      lastSeenAt: new Date(),
      lastIp: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .where(eq(displays.id, d.id));
  await audit({
    organizationId: d.organizationId,
    branchId: d.branchId,
    actorType: "device",
    action: "display.paired",
    entityType: "display",
    entityId: d.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  // A screen that was paired before is replaced: tell it to go back to the pairing page.
  io()?.to(`display:${d.id}`).emit("display.revoked", { reason: "replaced" });
  return { token, displayId: d.id, name: d.name, kind: d.kind };
}

const lastTouch = new Map<string, number>();

export type DeviceKind = "display" | "kiosk";

/**
 * Resolves a device token to its device. Throws `unauthorized` for unknown, unpaired or revoked devices, and for a
 * device of another kind: a kiosk token never opens the waiting-room screen's data, and a screen token never issues
 * tickets (D61).
 */
export async function authenticateDevice(token: string | null | undefined, meta?: { ip?: string }, kind: DeviceKind = "display") {
  if (!token) throw new AppError("unauthorized");
  const [d] = await db()
    .select()
    .from(displays)
    .where(eq(displays.tokenHash, sha256Hex(token)));
  if (!d || d.revokedAt || d.archivedAt || d.kind !== kind) throw new AppError("unauthorized");
  const now = Date.now();
  if (now - (lastTouch.get(d.id) ?? 0) > TOUCH_INTERVAL_MS) {
    lastTouch.set(d.id, now);
    await db()
      .update(displays)
      .set({ lastSeenAt: new Date(now), ...(meta?.ip ? { lastIp: meta.ip } : {}) })
      .where(eq(displays.id, d.id));
  }
  return d;
}

export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}
