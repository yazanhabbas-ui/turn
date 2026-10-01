/**
 * Production and development entry point: one Node process serving Next.js pages + REST API,
 * the Socket.IO realtime hub and pg-boss background jobs.
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { pool } from "./src/db/client";
import { env } from "./src/server/env";
import { startJobs, stopJobs } from "./src/server/jobs";
import { setDraining } from "./src/server/lifecycle";
import { logger } from "./src/server/logger";
import { startQueueMaintenance, stopQueueMaintenance } from "./src/server/queue/maintenance";
import { startRetentionScheduler, stopRetentionScheduler } from "./src/server/privacy/scheduler";
import { initRealtime, io } from "./src/server/realtime";
import { startReportScheduler, stopReportScheduler } from "./src/server/reports/scheduler";
import { assertSecureConfiguration } from "./src/server/security/startup";

async function main() {
  const config = env();
  assertSecureConfiguration(config);
  const dev = config.NODE_ENV !== "production";
  // Development bundler: webpack by default (~45 ms warm requests). DEV_BUNDLER=turbopack compiles first visits
  // faster, but measured ~450 ms per warm request on Windows with this custom server.
  const turbopack = dev && process.env.DEV_BUNDLER === "turbopack";
  const app = next({ dev, turbopack, hostname: "localhost", port: config.PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    // Pass the real socket address to route handlers; never trust a client-supplied copy.
    delete req.headers["x-dor-client-ip"];
    req.headers["x-dor-client-ip"] = req.socket.remoteAddress ?? "unknown";
    // Browsers must keep using https once they have seen it (set here because it depends on the runtime APP_URL).
    if (config.APP_URL.startsWith("https://")) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    handle(req, res);
  });
  // Slow-request (slowloris) limits: headers must arrive within 20 s and a whole request within 60 s.
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;

  initRealtime(server);
  await startJobs();
  startQueueMaintenance();
  startReportScheduler();
  startRetentionScheduler();

  await listen(server, config.PORT, config.HOSTNAME);
  logger.info({ port: config.PORT, host: config.HOSTNAME, dev, turbopack }, `Dor ready on ${config.APP_URL}`);

  // Graceful shutdown (docker stop sends SIGTERM): report not-ready, stop timers, stop accepting connections and
  // disconnect Socket.IO clients (they reconnect to the restarted server by themselves), let in-flight requests
  // finish, drain pg-boss, close the database pool. Forced exit after SHUTDOWN_TIMEOUT_SECONDS (default 20).
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    setDraining();
    const force = setTimeout(
      () => {
        logger.error("graceful shutdown timed out; forcing exit");
        process.exit(1);
      },
      Number(process.env.SHUTDOWN_TIMEOUT_SECONDS ?? 20) * 1000,
    );
    force.unref();
    try {
      stopQueueMaintenance();
      stopReportScheduler();
      stopRetentionScheduler();
      server.closeIdleConnections();
      // io.close() disconnects every socket and closes the HTTP server (waits for requests in flight).
      await Promise.race([
        new Promise<void>((resolve) => (io() ?? server).close(() => resolve())),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            server.closeAllConnections();
            resolve();
          }, 8_000).unref(),
        ),
      ]);
      await stopJobs();
      await pool().end();
      logger.info("shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * Listens dual-stack by default ("::" accepts IPv4 and IPv6). Binding IPv4 only makes every browser request
 * to "localhost" on Windows wait ~200 ms for the IPv6 attempt to fail first. Hosts without IPv6 fall back to IPv4.
 */
function listen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (host === "::" && (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL")) {
        logger.warn("IPv6 unavailable, listening on IPv4 only");
        server.listen(port, "0.0.0.0", () => resolve());
      } else reject(err);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
