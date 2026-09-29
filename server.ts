/**
 * Production and development entry point: one Node process serving Next.js pages + REST API,
 * the Socket.IO realtime hub and pg-boss background jobs.
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { env } from "./src/server/env";
import { startJobs, stopJobs } from "./src/server/jobs";
import { logger } from "./src/server/logger";
import { startQueueMaintenance, stopQueueMaintenance } from "./src/server/queue/maintenance";
import { initRealtime } from "./src/server/realtime";

async function main() {
  const config = env();
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
    handle(req, res);
  });

  initRealtime(server);
  await startJobs();
  startQueueMaintenance();

  await listen(server, config.PORT, config.HOSTNAME);
  logger.info({ port: config.PORT, host: config.HOSTNAME, dev, turbopack }, `Dor ready on ${config.APP_URL}`);

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopQueueMaintenance();
    server.close(() => stopJobs().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
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
