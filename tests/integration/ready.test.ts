import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/db/client";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { isDraining, setDraining } from "@/server/lifecycle";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

describe.runIf(available)("health and readiness probes", () => {
  afterAll(async () => {
    (globalThis as { __dorDraining?: boolean }).__dorDraining = undefined;
    await pool().end();
  });

  it("liveness answers 200 with the database up", async () => {
    const res = await health();
    expect(res.status).toBe(200);
  });

  it("readiness is ready on a migrated database (jobs run inline outside the server)", async () => {
    const res = await ready();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ database: "ok", migrated: true, jobs: "inline", draining: false });
    expect(body.status).toBe("degraded");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("readiness turns 503 once the process is draining (SIGTERM received)", async () => {
    expect(isDraining()).toBe(false);
    setDraining();
    const res = await ready();
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("not_ready");
  });
});
