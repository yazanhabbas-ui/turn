import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { jobsRunning } from "@/server/jobs";
import { isDraining } from "@/server/lifecycle";
import { io } from "@/server/realtime";

export const dynamic = "force-dynamic";

/**
 * Readiness probe for monitoring and reverse proxies. 200 only when the database answers, the schema has been
 * migrated and the process is not shutting down. The background worker (pg-boss) is reported as `jobs`:
 * "running", or "inline" when it could not start (handlers then run synchronously, nothing is lost), which is
 * `degraded` but still ready. Liveness (is the process up) is `/api/health`.
 */
export async function GET() {
  let database: "ok" | "down" = "ok";
  let migrated = true;
  try {
    await db().execute(sql`select 1`);
    const res = await db().execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    migrated = (res.rows[0]?.n ?? 0) > 0;
  } catch {
    database = "down";
    migrated = false;
  }
  const draining = isDraining();
  const jobs = jobsRunning() ? "running" : "inline";
  const ready = database === "ok" && migrated && !draining;
  return NextResponse.json(
    {
      status: !ready ? "not_ready" : jobs === "running" ? "ok" : "degraded",
      database,
      migrated,
      jobs,
      realtime: io() ? "ok" : "off",
      draining,
      time: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
