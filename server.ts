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
  const app = next({ dev, hostname: config.HOSTNAME, port: config.PORT });
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

  server.listen(config.PORT, config.HOSTNAME, () => {
    logger.info({ port: config.PORT, dev }, `Dor ready on ${config.APP_URL}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopQueueMaintenance();
    server.close(() => stopJobs().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
