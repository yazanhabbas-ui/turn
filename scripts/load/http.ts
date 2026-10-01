/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API under test are untyped here */
import http from "node:http";
import { performance } from "node:perf_hooks";

/** Latency and outcome counters per request group (e.g. "issue", "call-next"). */
export class Stats {
  private latencies = new Map<string, number[]>();
  private counts = new Map<string, { total: number; failed: number; rateLimited: number; statuses: Map<string, number> }>();
  /** First few failure descriptions per group, to explain a red result. */
  readonly failureSamples = new Map<string, string[]>();

  record(group: string, ms: number, outcome: "ok" | "failed" | "rate_limited", label: string, detail?: string) {
    let c = this.counts.get(group);
    if (!c) this.counts.set(group, (c = { total: 0, failed: 0, rateLimited: 0, statuses: new Map() }));
    c.total++;
    c.statuses.set(label, (c.statuses.get(label) ?? 0) + 1);
    if (outcome === "failed") {
      c.failed++;
      const s = this.failureSamples.get(group) ?? [];
      if (s.length < 5) s.push(detail ?? label);
      this.failureSamples.set(group, s);
    } else if (outcome === "rate_limited") c.rateLimited++;
    // Latency of failed calls still counts: a slow error is slow.
    let l = this.latencies.get(group);
    if (!l) this.latencies.set(group, (l = []));
    l.push(ms);
  }

  groups() {
    return [...this.counts.keys()].sort();
  }

  summary(group: string) {
    const c = this.counts.get(group)!;
    const l = [...(this.latencies.get(group) ?? [])].sort((a, b) => a - b);
    return {
      requests: c.total,
      failed: c.failed,
      rateLimited: c.rateLimited,
      statuses: Object.fromEntries(c.statuses),
      p50: percentile(l, 50),
      p95: percentile(l, 95),
      p99: percentile(l, 99),
      max: l.length ? l[l.length - 1] : 0,
      mean: l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0,
    };
  }
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export type CallResult<T = any> = { status: number; body: T; ms: number; headers: http.IncomingHttpHeaders };
type CallOpts = {
  /** Statuses that count as success (default 200 and 201). */
  ok?: number[];
  json?: unknown;
  headers?: Record<string, string>;
  /** Do not record in the statistics (setup calls). */
  quiet?: boolean;
  /** Return the raw body text instead of parsing JSON. */
  raw?: boolean;
  timeoutMs?: number;
};

/** One simulated client: its own network address (X-Forwarded-For) and, once signed in, its session cookie. */
export class Client {
  cookie = "";
  constructor(
    private readonly http: Http,
    readonly ip: string,
    readonly label = "",
  ) {}

  async login(email: string, password: string) {
    const r = await this.call("login", "POST", "/api/v1/auth/login", { json: { email, password }, quiet: true });
    const cookies = (r.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]);
    if (!cookies.length) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    this.cookie = cookies.join("; ");
    return this;
  }

  call<T = any>(group: string, method: string, path: string, opts: CallOpts = {}): Promise<CallResult<T>> {
    return this.http.request<T>(group, method, path, {
      ...opts,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), "x-forwarded-for": this.ip, ...opts.headers },
    });
  }
}

export class Http {
  readonly stats = new Stats();
  /** Requests are only counted while this is true (the warm-up before the measured period is not). */
  recording = false;
  private readonly agent = new http.Agent({ keepAlive: true, maxSockets: 512 });
  private readonly url: URL;
  private ipCounter = 0;

  constructor(readonly baseUrl: string) {
    this.url = new URL(baseUrl);
  }

  /** A client with a fresh, unique simulated address (so per-address rate limits behave as with real devices). */
  client(label = ""): Client {
    const n = ++this.ipCounter;
    return new Client(this, `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, label);
  }

  destroy() {
    this.agent.destroy();
  }

  request<T = any>(group: string, method: string, path: string, opts: CallOpts = {}): Promise<CallResult<T>> {
    return new Promise((resolve) => {
      const ok = opts.ok ?? [200, 201];
      const payload = opts.json === undefined ? undefined : JSON.stringify(opts.json);
      const started = performance.now();
      let settled = false;
      const done = (status: number, body: any, headers: http.IncomingHttpHeaders, errorText?: string) => {
        if (settled) return;
        settled = true;
        const ms = performance.now() - started;
        if (!opts.quiet && this.recording) {
          if (errorText) this.stats.record(group, ms, "failed", "error", `${method} ${path}: ${errorText}`);
          else if (status === 429) this.stats.record(group, ms, "rate_limited", "429");
          else if (ok.includes(status)) this.stats.record(group, ms, "ok", String(status));
          else
            this.stats.record(group, ms, "failed", String(status), `${method} ${path}: ${status} ${String(body).slice(0, 160)}`);
        }
        resolve({ status, body, ms, headers });
      };
      const req = http.request(
        {
          agent: this.agent,
          host: this.url.hostname,
          port: this.url.port,
          path,
          method,
          headers: {
            origin: this.baseUrl,
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
            ...opts.headers,
          },
          timeout: opts.timeoutMs ?? 30_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let body: any = text;
            if (!opts.raw && (res.headers["content-type"] ?? "").includes("json")) {
              try {
                body = JSON.parse(text);
              } catch {
                body = text;
              }
            }
            done(res.statusCode ?? 0, body, res.headers);
          });
          res.on("error", (e) => done(0, null, {}, e.message));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => done(0, null, {}, e.message));
      if (payload) req.write(payload);
      req.end();
    });
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
