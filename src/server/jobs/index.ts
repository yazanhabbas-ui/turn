import { PgBoss } from "pg-boss";
import { env } from "../env";
import { logger } from "../logger";
import { sendTemplated, type SendRequest } from "../messaging/service";

/**
 * Background jobs on pg-boss (PostgreSQL-backed, no Redis needed). Every job kind has a handler here.
 * When the worker is not running (tests, scripts) `enqueue` executes the handler inline so behaviour
 * stays identical, just synchronous.
 */
type JobMap = {
  "messages.send": SendRequest;
};
type JobName = keyof JobMap;

const handlers: { [K in JobName]: (data: JobMap[K]) => Promise<unknown> } = {
  "messages.send": (data) => sendTemplated(data),
};

const g = globalThis as unknown as { __dorBoss?: PgBoss };

export async function startJobs(): Promise<void> {
  if (g.__dorBoss) return;
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  for (const name of Object.keys(handlers) as JobName[]) {
    await boss.createQueue(name, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
    await boss.work<JobMap[typeof name]>(name, async (jobs) => {
      for (const job of jobs) await handlers[name](job.data as never);
    });
  }
  g.__dorBoss = boss;
  logger.info("background jobs started");
}

export async function stopJobs(): Promise<void> {
  await g.__dorBoss?.stop({ graceful: true, timeout: 10_000 });
  g.__dorBoss = undefined;
}

export async function enqueue<K extends JobName>(name: K, data: JobMap[K]): Promise<void> {
  const boss = g.__dorBoss;
  if (!boss) {
    await handlers[name](data as never);
    return;
  }
  await boss.send(name, data as object);
}
