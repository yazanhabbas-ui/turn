import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import { db } from "@/db/client";
import { branches } from "@/db/schema";
import { can } from "@/domain/rbac/permissions";
import { sessionCookieName, validateSessionToken } from "../auth/session";
import { authenticateDevice } from "../display/device";
import { env } from "../env";
import { AppError } from "../http/errors";
import { logger } from "../logger";
import { rateLimit } from "../rate-limit";

/**
 * Realtime hub. The server is the single source of truth: clients subscribe to rooms and receive events,
 * they never compute queue state. Rooms: `org:<id>`, `branch:<id>`, `user:<id>`, `display:<id>`, `displays:<orgId>`.
 * Socket.IO falls back to HTTP long-polling automatically when WebSockets are blocked.
 */
const g = globalThis as unknown as { __dorIo?: Server };

export function io(): Server | undefined {
  return g.__dorIo;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Concurrent sockets per client address (waiting-room screens of one office share an address, so this is generous). */
export const MAX_SOCKETS_PER_IP = 300;
/** New handshakes per client address per minute (a screen reconnecting in a loop cannot hammer the database). */
export const HANDSHAKES_PER_MINUTE = 240;
/** Largest message a client may send; clients only ever send tiny subscribe messages. */
export const MAX_MESSAGE_BYTES = 8 * 1024;

/**
 * Cross-site WebSocket hijacking guard: browsers always send Origin on a handshake, and it must be this site. Requests
 * without Origin are not from a browser page (native clients, curl) and cannot ride on a victim's cookies.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost === host || originHost === new URL(env().APP_URL).host;
}

/** Client address of a handshake, with the same proxy rules as the REST API (see clientIp in http/route.ts). */
export function handshakeIp(headers: Record<string, string | string[] | undefined>, remote: string | undefined): string {
  if (env().TRUST_PROXY) {
    const fwd = headers["x-forwarded-for"];
    const parts = (Array.isArray(fwd) ? fwd.join(",") : (fwd ?? ""))
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const hit = parts[Math.max(0, parts.length - env().TRUST_PROXY_HOPS)];
    if (hit) return hit;
  }
  return remote ?? "unknown";
}

const socketsPerIp = new Map<string, number>();

/** Disconnects every socket of a user (their sessions were ended: logout, password change, deactivation, forced logout). */
export function disconnectUserSockets(userId: string) {
  g.__dorIo?.in(`user:${userId}`).disconnectSockets(true);
}

/** Disconnects the sockets that were opened with one session. */
export function disconnectSessionSockets(sessionId: string) {
  g.__dorIo?.in(`session:${sessionId}`).disconnectSockets(true);
}

export function initRealtime(server: HttpServer): Server {
  const hub = new Server(server, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // No CORS headers are ever sent: only pages of this site may open a socket.
    allowRequest: (req, callback) => {
      callback(null, originAllowed(req.headers.origin, req.headers.host));
    },
    // Clients replay missed events after short network drops.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });

  hub.use(async (socket, next) => {
    try {
      const ip = handshakeIp(socket.handshake.headers, socket.handshake.address);
      if ((socketsPerIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) return next(new Error("too_many_connections"));
      const r = await rateLimit(`socket-handshake:${ip}`, HANDSHAKES_PER_MINUTE, 60_000);
      if (!r.ok) return next(new Error("rate_limited"));
      socket.data.ip = ip;
      // Waiting-room screens authenticate with their device token instead of a user session.
      const deviceToken = socket.handshake.auth?.deviceToken;
      if (typeof deviceToken === "string") {
        // A self check-in kiosk says so; its token is refused for any other kind and the other way round.
        if (socket.handshake.auth?.kind === "kiosk") socket.data.kiosk = await authenticateDevice(deviceToken, { ip }, "kiosk");
        else socket.data.display = await authenticateDevice(deviceToken);
        return next();
      }
      const token = readCookie(socket.handshake.headers.cookie, sessionCookieName());
      const auth = token ? await validateSessionToken(token) : null;
      // Device tokens (displays) are accepted here in the display milestone.
      if (!auth || !auth.twoFactorVerified) return next(new Error("unauthorized"));
      socket.data.auth = auth;
      next();
    } catch (err) {
      // Never send internal error text (database messages) to a client.
      next(new Error(err instanceof AppError ? err.code : "server_error"));
    }
  });

  hub.on("connection", (socket) => {
    const ip = socket.data.ip as string;
    socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);
    socket.on("disconnect", () => {
      const n = (socketsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) socketsPerIp.delete(ip);
      else socketsPerIp.set(ip, n);
    });
    const kiosk = socket.data.kiosk as { branchId: string; organizationId: string } | undefined;
    if (kiosk) {
      // A kiosk only hears "refetch your context" for its own branch or organization (D66); it receives no queue events.
      socket.join([`kiosk:${kiosk.branchId}`, `kiosks:${kiosk.organizationId}`]);
      return;
    }
    const display = socket.data.display as { id: string; branchId: string; organizationId: string } | undefined;
    if (display) {
      // Read-only: a screen only receives events for its own branch.
      socket.join([`screens:${display.branchId}`, `display:${display.id}`, `displays:${display.organizationId}`]);
      return;
    }
    const auth = socket.data.auth;
    socket.join([`org:${auth.user.organizationId}`, `user:${auth.user.id}`, `session:${auth.sessionId}`]);
    logger.debug({ userId: auth.user.id }, "socket connected");

    // Clients subscribe to a branch they may see; queue events for that branch are pushed to them.
    socket.on("subscribe", async (msg: { branchId?: string }, ack?: (r: { ok: boolean }) => void) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      try {
        const branchId = typeof msg?.branchId === "string" ? msg.branchId : null;
        let ok =
          !!branchId && ["tickets.view", "agent.serve", "wallboard.view"].some((p) => can(auth.grants, p as never, branchId));
        if (ok && branchId) {
          // An organization-wide grant must still not reach a branch of another organization.
          const [b] = await db().select({ o: branches.organizationId }).from(branches).where(eq(branches.id, branchId));
          ok = !!b && b.o === auth.user.organizationId;
        }
        if (ok) socket.join(`branch:${branchId}`);
        reply({ ok });
      } catch {
        reply({ ok: false });
      }
    });
    socket.on("unsubscribe", (msg: { branchId?: string }) => {
      if (typeof msg?.branchId === "string") socket.leave(`branch:${msg.branchId}`);
    });
  });

  g.__dorIo = hub;
  return hub;
}
