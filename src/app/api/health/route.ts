import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/** Liveness + readiness probe used by Docker healthcheck and monitoring. */
export async function GET() {
  let database: "ok" | "down" = "ok";
  try {
    await db().execute(sql`select 1`);
  } catch {
    database = "down";
  }
  const ok = database === "ok";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      database,
      version: process.env.APP_VERSION ?? "dev",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
