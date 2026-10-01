/**
 * Load test runner (npm run load:smoke | load:full). See docs/load-testing.md.
 *
 *   npm run load:smoke                       30 s of load against a private instance (port 3201, database dor_load)
 *   npm run load:full                        5 minutes, 20 agents, 120 tickets/min, 200 visitors, 30 screens
 *   BASE_URL=http://host:3000 LOAD_CONFIRM_THROWAWAY=yes npm run load:smoke
 *                                            against an instance you started (it creates agents, desks and displays in it!)
 *
 * Settings (all optional): LOAD_DATABASE_URL, LOAD_PORT, LOAD_AGENTS, LOAD_RATE (tickets per minute), LOAD_DURATION
 * (seconds), LOAD_DRAIN, LOAD_VISITORS, LOAD_DISPLAYS, LOAD_WALLBOARDS, LOAD_SERVICE_SEC, LOAD_MODE (pull|push),
 * LOAD_HISTORY (completed tickets of earlier days to add first; full: 100000), LOAD_THRESHOLD_FACTOR (default 5 for smoke, 1 for full),
 * LOAD_MAX_RSS_GROWTH_MB, LOAD_KEEP=1 (keep the database).
 * Exit code 1 when a threshold or a queue invariant fails.
 */
import os from "node:os";
import path from "node:path";
import { dropDatabase, ensureBuild, migrateAndSeed, recreateDatabase, root, startApp, type AppInstance } from "../lib/harness";
import { seedHistory } from "./history";
import { checkInvariants } from "./invariants";
import { evaluate, summarizeProbe, thresholds, writeReport, type Report } from "./report";
import { PROFILES, Scenario, type Profile } from "./scenario";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

function profileFromEnv(): Profile {
  const base = PROFILES[arg("profile") ?? "smoke"];
  if (!base) throw new Error(`unknown profile; use one of ${Object.keys(PROFILES).join(", ")}`);
  const e = process.env;
  return {
    ...base,
    agents: num(e.LOAD_AGENTS, base.agents),
    ratePerMin: num(e.LOAD_RATE, base.ratePerMin),
    durationSec: num(e.LOAD_DURATION, base.durationSec),
    drainSec: num(e.LOAD_DRAIN, base.drainSec),
    visitors: num(e.LOAD_VISITORS, base.visitors),
    displays: num(e.LOAD_DISPLAYS, base.displays),
    wallboards: num(e.LOAD_WALLBOARDS, base.wallboards),
    serviceMeanSec: num(e.LOAD_SERVICE_SEC, base.serviceMeanSec),
    mode: e.LOAD_MODE === "push" ? "push" : base.mode,
  };
}

async function main() {
  const profile = profileFromEnv();
  const external = process.env.BASE_URL;
  const port = num(process.env.LOAD_PORT, 3201);
  const dbUrl = process.env.LOAD_DATABASE_URL ?? "postgres://dor:dor@localhost:5433/dor_load";
  const probeFile = path.join(root, "load-results", `probe-${profile.name}.jsonl`);
  const startedAt = new Date().toISOString();
  let app: AppInstance | undefined;
  let baseUrl: string;

  if (external) {
    if (new URL(external).port === "3000") throw new Error("Refusing to load-test port 3000 (the development app)");
    if (process.env.LOAD_CONFIRM_THROWAWAY !== "yes") {
      throw new Error(
        "BASE_URL mode creates agents, desks, displays and thousands of tickets in that instance. Set LOAD_CONFIRM_THROWAWAY=yes to confirm it is disposable.",
      );
    }
    baseUrl = external.replace(/\/$/, "");
    console.log(
      `[load] external instance ${baseUrl}; its TRUST_PROXY should be true, or every client shares one address and is rate limited`,
    );
  } else {
    console.log(`[load] preparing database ${new URL(dbUrl).pathname.slice(1)} and a private app on port ${port}`);
    const distDir = await ensureBuild();
    await recreateDatabase(dbUrl);
    await migrateAndSeed(dbUrl);
    const { rmSync } = await import("node:fs");
    rmSync(probeFile, { force: true });
    app = await startApp({
      port,
      dbUrl,
      distDir,
      logFile: path.join(root, "load-results", "app.log"),
      preload: [path.join(root, "scripts", "load", "probe.mjs")],
      // Every simulated client has its own address (X-Forwarded-For); without this they would share one rate-limit bucket.
      env: { TRUST_PROXY: "true", LOAD_PROBE_FILE: probeFile },
    });
    baseUrl = app.baseUrl;
  }

  const scenario = new Scenario(baseUrl, profile);
  let exitCode = 1;
  try {
    console.log(
      `[load] ${profile.name}: ${profile.agents} agents, ${profile.ratePerMin}/min for ${profile.durationSec} s, ${profile.visitors} visitors, ${profile.displays} screens, ${profile.wallboards} wallboards, mode ${profile.mode}`,
    );
    const t0 = Date.now();
    await scenario.provision();
    const history = num(process.env.LOAD_HISTORY, profile.name === "full" ? 100_000 : 0);
    if (history > 0 && !external) {
      const h0 = Date.now();
      await seedHistory(dbUrl, history, { assigned: profile.mode === "push" });
      console.log(`[load] ${history} completed tickets of earlier days added in ${((Date.now() - h0) / 1000).toFixed(1)} s`);
    }
    const dataFrom = new Date().toISOString();
    console.log(`[load] provisioned in ${((Date.now() - t0) / 1000).toFixed(1)} s; running`);
    const ticker = setInterval(() => {
      const l = scenario.log;
      console.log(
        `[load] issued ${l.issued.length}, completed ${l.completed.size}, sockets ${l.socketsConnected}/${l.socketsExpected}`,
      );
    }, 10_000);
    const run = await scenario.run();
    clearInterval(ticker);
    scenario.stop();
    console.log(`[load] load finished (${run.drained ? "queue drained" : "queue NOT drained"}); checking invariants`);

    const dbForChecks = external ? process.env.LOAD_DATABASE_URL : dbUrl;
    const invariants = dbForChecks
      ? await checkInvariants({
          databaseUrl: dbForChecks,
          log: scenario.log,
          drained: run.drained,
          since: dataFrom,
          issueFailures: scenario.http.stats.groups().includes("issue") ? scenario.http.stats.summary("issue").failed : 0,
        })
      : [
          {
            name: "database checks",
            ok: false,
            detail: "set LOAD_DATABASE_URL to the instance's database to check the queue invariants",
          },
        ];

    const endpoints = Object.fromEntries(scenario.http.stats.groups().map((g) => [g, scenario.http.stats.summary(g)]));
    const cpus = os.cpus();
    const base: Omit<Report, "verdicts" | "passed"> = {
      profile,
      startedAt,
      baseUrl,
      ownInstance: !external,
      machine: `${os.type()} ${os.release()}, ${cpus[0]?.model.trim()} x${cpus.length}, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, Node ${process.version}`,
      loadSeconds: run.loadSeconds,
      drainSeconds: run.drainSeconds,
      drained: run.drained,
      issued: scenario.log.issued.length,
      completed: scenario.log.completed.size,
      throughputPerMin: (scenario.log.completed.size / (run.loadSeconds + run.drainSeconds)) * 60,
      endpoints,
      delivery: scenario.deliverySummary(),
      sockets: {
        expected: scenario.log.socketsExpected,
        connected: scenario.log.socketsConnected,
        errors: scenario.log.socketErrors.slice(0, 5),
      },
      probe: external ? null : summarizeProbe(probeFile, scenario.measuredFrom),
      invariants,
      failureSamples: Object.fromEntries(scenario.http.stats.failureSamples),
    };
    const verdicts = evaluate(base, thresholds(profile.name));
    const report: Report = { ...base, verdicts, passed: verdicts.every((v) => v.ok) };
    const files = writeReport(report, path.join(root, "load-results"));

    console.log("");
    for (const v of verdicts) console.log(`${v.ok ? "  pass" : "  FAIL"}  ${v.name}: ${v.detail}`);
    console.log(`\n[load] ${report.passed ? "PASSED" : "FAILED"}; report: ${path.relative(root, files.md)}`);
    exitCode = report.passed ? 0 : 1;
  } catch (err) {
    console.error("[load] aborted:", err);
    exitCode = 1;
  } finally {
    scenario.stop();
    await app?.stop();
    if (!external && !process.env.LOAD_KEEP) await dropDatabase(dbUrl);
  }
  process.exit(exitCode);
}

void main();
