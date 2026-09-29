import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { can } from "@/domain/rbac/permissions";
import { SESSION_COOKIE, validateSessionToken } from "../auth/session";
import { authenticateDevice } from "../display/device";
import { logger } from "../logger";

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
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function initRealtime(server: HttpServer): Server {
  const hub = new Server(server, {
    path: "/socket.io",
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    // Clients replay missed events after short network drops.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });

  hub.use(async (socket, next) => {
    try {
      // Waiting-room screens authenticate with their device token instead of a user session.
      const deviceToken = socket.handshake.auth?.deviceToken;
      if (typeof deviceToken === "string") {
        socket.data.display = await authenticateDevice(deviceToken);
        return next();
      }
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const auth = token ? await validateSessionToken(token) : null;
      // Device tokens (displays) are accepted here in the display milestone.
      if (!auth || !auth.twoFactorVerified) return next(new Error("unauthorized"));
      socket.data.auth = auth;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  hub.on("connection", (socket) => {
    const display = socket.data.display as { id: string; branchId: string; organizationId: string } | undefined;
    if (display) {
      // Read-only: a screen only receives events for its own branch.
      socket.join([`screens:${display.branchId}`, `display:${display.id}`, `displays:${display.organizationId}`]);
      return;
    }
    const auth = socket.data.auth;
    socket.join([`org:${auth.user.organizationId}`, `user:${auth.user.id}`]);
    logger.debug({ userId: auth.user.id }, "socket connected");

    // Clients subscribe to a branch they may see; queue events for that branch are pushed to them.
    socket.on("subscribe", (msg: { branchId?: string }, ack?: (r: { ok: boolean }) => void) => {
      const branchId = typeof msg?.branchId === "string" ? msg.branchId : null;
      const ok =
        !!branchId && ["tickets.view", "agent.serve", "wallboard.view"].some((p) => can(auth.grants, p as never, branchId));
      if (ok) socket.join(`branch:${branchId}`);
      ack?.({ ok });
    });
    socket.on("unsubscribe", (msg: { branchId?: string }) => {
      if (typeof msg?.branchId === "string") socket.leave(`branch:${msg.branchId}`);
    });
  });

  g.__dorIo = hub;
  return hub;
}
