/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies of the API under test are untyped here */
/**
 * "Busy morning": one branch, N agents signed in, reception issuing tickets at a steady rate, agents calling, serving
 * and completing with random service times, while visitors' phones poll their status page, waiting-room screens and
 * wallboards stay connected by Socket.IO, and a manager keeps opening reports. Every simulated client uses the same
 * calls (and the same refetch-on-event rules) as the real screens in src/features.
 */
import { io, type Socket } from "socket.io-client";
import { Client, Http, sleep, percentile } from "./http";

export type Profile = {
  name: string;
  agents: number;
  /** Tickets per minute at reception. */
  ratePerMin: number;
  /** Seconds of load (reception issues for this long). */
  durationSec: number;
  /** Seconds allowed afterwards for the agents to clear the queue. */
  drainSec: number;
  visitors: number;
  displays: number;
  wallboards: number;
  /** Mean seconds an agent serves one visitor (uniform between 0.4x and 1.6x). */
  serviceMeanSec: number;
  /** Mean seconds between "called" and "start" (the visitor walks to the desk). */
  walkSec: number;
  /** Seconds between report requests of the manager. */
  reportEverySec: number;
  mode: "pull" | "push";
};

export const PROFILES: Record<string, Profile> = {
  smoke: {
    name: "smoke",
    agents: 5,
    ratePerMin: 45,
    durationSec: 30,
    drainSec: 60,
    visitors: 20,
    displays: 3,
    wallboards: 2,
    serviceMeanSec: 3,
    walkSec: 1,
    reportEverySec: 3,
    mode: "pull",
  },
  full: {
    name: "full",
    agents: 20,
    ratePerMin: 120,
    durationSec: 300,
    drainSec: 180,
    visitors: 200,
    displays: 30,
    wallboards: 10,
    serviceMeanSec: 8,
    walkSec: 1.5,
    reportEverySec: 5,
    mode: "pull",
  },
};

export const AGENT_PASSWORD = "Load-Pass-2026x";
const ADMIN = { email: "admin@dor.local", password: process.env.SEED_PASSWORD ?? "Dor@Demo2026" };
const SUPERVISOR = { email: "supervisor@dor.local", password: ADMIN.password };
const RECEPTION = { email: "reception@dor.local", password: ADMIN.password };

export type IssuedTicket = { id: string; token: string; displayNumber: string; reasonCode: string; issuedAt: number };

export type RunLog = {
  issued: IssuedTicket[];
  /** ticketId -> agent index that received it from call-next (a ticket must be handed out exactly once). */
  calledBy: Map<string, number[]>;
  completed: Set<string>;
  violations: string[];
  /** ticketId -> performance timestamps: request sent / first display received the call. */
  callSentAt: Map<string, number>;
  /** ticket.called arrivals at screens that came before the sender registered the call. */
  displayArrivals: Map<string, number[]>;
  staffReceived: number[];
  callToDisplayMs: number[];
  duplicatesIssued: number;
  socketErrors: string[];
  socketsConnected: number;
  socketsExpected: number;
};

export function newRunLog(): RunLog {
  return {
    issued: [],
    calledBy: new Map(),
    completed: new Set(),
    violations: [],
    callSentAt: new Map(),
    displayArrivals: new Map(),
    staffReceived: [],
    callToDisplayMs: [],
    duplicatesIssued: 0,
    socketErrors: [],
    socketsConnected: 0,
    socketsExpected: 0,
  };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const expo = (mean: number) => -Math.log(1 - Math.random()) * mean;

/**
 * Like useLiveQuery + react-query in the real screens: bursts of events cause one refetch 150 ms later, and a screen
 * never has two refetches of the same query in flight (an event arriving meanwhile schedules one more afterwards).
 */
function debounced(fn: () => unknown, ms = 150) {
  let t: NodeJS.Timeout | null = null;
  let inflight = false;
  let again = false;
  const run = async () => {
    if (inflight) {
      again = true;
      return;
    }
    inflight = true;
    try {
      await fn();
    } finally {
      inflight = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => void run(), ms);
  };
}

type Ids = { branchId: string; reasons: Record<string, string> };

export class Scenario {
  readonly http: Http;
  readonly log = newRunLog();
  readonly sockets: Socket[] = [];
  /** Start of the measured period (everything before it is warm-up). */
  measuredFrom = new Date().toISOString();
  private running = true;
  private issuing = true;
  private admin!: Client;
  private ids!: Ids;
  private agentClients: Client[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  /** performance.now() reference shared with the socket handlers. */
  private readonly now = () => performance.now();

  constructor(
    readonly baseUrl: string,
    readonly profile: Profile,
  ) {
    this.http = new Http(baseUrl);
  }

  // ─── Setup ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async provision() {
    const p = this.profile;
    this.admin = await this.http.client("admin").login(ADMIN.email, ADMIN.password);
    const lookups = (await this.admin.call("setup", "GET", "/api/v1/admin/lookups", { quiet: true })).body;
    const branch = lookups.branches.find((b: any) => b.isDefault) ?? lookups.branches[0];
    const agentRole = lookups.roles.find((r: any) => r.key === "agent");
    const reasonsList = (await this.admin.call("setup", "GET", "/api/v1/admin/reasons", { quiet: true })).body;
    const reasons: Record<string, string> = {};
    for (const r of reasonsList.items ?? reasonsList) reasons[r.code] = r.id;
    this.ids = { branchId: branch.id, reasons };

    // Desks and agents (the demo's six desks stay unused).
    const userIds: string[] = [];
    const created: { id: string; email: string }[] = [];
    for (let i = 1; i <= p.agents; i++) {
      const n = String(i).padStart(2, "0");
      const desk = await this.admin.call("setup", "POST", `/api/v1/admin/branches/${branch.id}/desks`, {
        json: { number: `L${n}`, name: { ar: `مكتب الاختبار ${n}`, en: `Load desk ${n}` }, sortOrder: 100 + i },
        quiet: true,
      });
      if (desk.status !== 200 && desk.status !== 201) throw new Error(`desk ${n}: ${desk.status} ${JSON.stringify(desk.body)}`);
      const email = `load.agent.${n}@dor.local`;
      const user = await this.admin.call("setup", "POST", "/api/v1/admin/users", {
        json: {
          email,
          displayName: { ar: `موظف اختبار ${n}`, en: `Load Agent ${n}` },
          password: AGENT_PASSWORD,
          grants: [{ roleId: agentRole.id, branchId: branch.id, cityId: null }],
          agent: { branchId: branch.id, defaultDeskId: desk.body.id, maxConcurrent: null, shiftId: null, weight: 1 },
        },
        quiet: true,
      });
      if (user.status !== 200 && user.status !== 201) throw new Error(`user ${n}: ${user.status} ${JSON.stringify(user.body)}`);
      userIds.push(user.body.id);
      created.push({ id: user.body.id, email });
    }
    // One group with all of them serves the three reasons used by the scenario.
    const group = await this.admin.call("setup", "POST", "/api/v1/admin/groups", {
      json: { name: { ar: "موظفو الاختبار", en: "Load agents" }, branchId: branch.id, memberIds: userIds },
      quiet: true,
    });
    if (group.status !== 200 && group.status !== 201) throw new Error(`group: ${group.status} ${JSON.stringify(group.body)}`);
    for (const code of ["general", "documents", "complaint"]) {
      const r = await this.admin.call("setup", "PUT", `/api/v1/admin/reasons/${reasons[code]}/assignments`, {
        json: [{ groupId: group.body.id, proficiency: 3, isPrimary: true }],
        quiet: true,
      });
      if (r.status !== 200) throw new Error(`assignments ${code}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    if (p.mode === "push") {
      await this.admin.call("setup", "PUT", "/api/v1/admin/distribution-rules", {
        json: { scope: "global", config: { mode: "push", push: { strategies: ["least_waiting", "round_robin"] } } },
        quiet: true,
      });
    }
    // Sign in the agents (a login is one of the heavier calls: argon2).
    for (const c of created) this.agentClients.push(await this.http.client(c.email).login(c.email, AGENT_PASSWORD));
  }

  // ─── Actors ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private socketFor(client: Client, kind: "staff" | "display", deviceToken?: string): Socket {
    const s = io(this.baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      extraHeaders: { "x-forwarded-for": client.ip, ...(client.cookie ? { cookie: client.cookie } : {}) },
      auth: deviceToken ? { deviceToken } : undefined,
    });
    this.log.socketsExpected++;
    s.on("connect", () => this.log.socketsConnected++);
    s.on("connect_error", (e) => this.log.socketErrors.push(`${kind}: ${e.message}`));
    this.sockets.push(s);
    return s;
  }

  private subscribe(s: Socket) {
    s.on("connect", () => s.emit("subscribe", { branchId: this.ids.branchId }));
  }

  /** What the receptionist taps: half general inquiries, a quarter each of documents and complaints (these two carry a field). */
  private ticketRequest(seq: number) {
    const n = Math.abs(seq);
    const branchId = this.ids.branchId;
    const roll = Math.random();
    const reasonCode = roll < 0.5 ? "general" : roll < 0.75 ? "documents" : "complaint";
    const fields: Record<string, string> =
      reasonCode === "documents"
        ? { national_id_last4: String(1000 + (n % 9000)) }
        : reasonCode === "complaint"
          ? { phone: `09${String(10_000_000 + n).slice(-8)}` }
          : {};
    const body = {
      branchId,
      reasonId: this.ids.reasons[reasonCode],
      priorityKey: Math.random() < 0.05 ? "vip" : null,
      language: "ar",
      fields,
      consent: reasonCode !== "general",
      source: "reception",
    };
    return { reasonCode, body };
  }

  /** Reception: issues tickets as a Poisson stream; also refetches what the reception screen shows after each event. */
  async receptionLoop() {
    const reception = await this.http.client("reception").login(RECEPTION.email, RECEPTION.password);
    const branchId = this.ids.branchId;
    const s = this.socketFor(reception, "staff");
    this.subscribe(s);
    const refetch = debounced(() =>
      Promise.all([
        reception.call("reception-state", "GET", `/api/v1/queue/state?branchId=${branchId}`),
        reception.call("reception-context", "GET", `/api/v1/queue/reception?branchId=${branchId}`),
      ]),
    );
    s.on("queue.updated", refetch);
    s.on("ticket.called", refetch);
    s.on("agent.updated", refetch);

    const mean = 60_000 / this.profile.ratePerMin;
    const end = this.now() + this.profile.durationSec * 1000;
    let seq = 0;
    const inflight = new Set<Promise<void>>();
    while (this.now() < end && this.running) {
      await sleep(expo(mean));
      const n = ++seq;
      const { reasonCode, body } = this.ticketRequest(n);
      // Concurrent issuing is realistic (several reception desks); each call has its own idempotency key.
      const key = `load-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`;
      const p = (async () => {
        const r = await reception.call("issue", "POST", "/api/v1/queue/tickets", {
          json: body,
          headers: { "idempotency-key": key },
        });
        if (r.status === 200 || r.status === 201) {
          if (r.body.duplicate) this.log.duplicatesIssued++;
          else
            this.log.issued.push({
              id: r.body.ticket.id,
              token: r.body.ticket.publicToken,
              displayNumber: r.body.ticket.displayNumber,
              reasonCode,
              issuedAt: Date.now(),
            });
        }
      })();
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
    }
    await Promise.allSettled([...inflight]);
    this.issuing = false;
  }

  /** One agent: available, then call -> walk -> start -> serve -> complete, forever until drained. */
  async agentLoop(index: number) {
    const c = this.agentClients[index];
    const branchId = this.ids.branchId;
    const s = this.socketFor(c, "staff");
    this.subscribe(s);
    let wake: (() => void) | null = null;
    s.on("queue.updated", () => wake?.());
    const refetch = debounced(() => c.call("agent-state", "GET", "/api/v1/queue/agent"));
    s.on("queue.updated", refetch);
    s.on("ticket.called", () => refetch());
    s.on("agent.updated", refetch);
    s.on("ticket.called", () => this.log.staffReceived.push(this.now()));

    await c.call("agent-status", "POST", "/api/v1/queue/agent/status", { json: { status: "AVAILABLE" } });
    await c.call("agent-state", "GET", "/api/v1/queue/agent");
    const p = this.profile;
    let holding: string | null = null;
    while (this.running) {
      const sentAt = this.now();
      const r = await c.call("call-next", "POST", "/api/v1/queue/call-next", { json: {} });
      const ticket = r.status === 200 ? r.body.ticket : null;
      if (!ticket) {
        // Nothing waiting: wait for news (or a second) before asking again, as an agent would glance at the screen.
        await Promise.race([new Promise<void>((res) => (wake = res)), sleep(1500)]);
        wake = null;
        if (!this.issuing && this.log.completed.size >= this.log.issued.length) break;
        continue;
      }
      if (holding) this.log.violations.push(`agent ${index} was handed ${ticket.id} while still holding ${holding}`);
      holding = ticket.id;
      const list = this.log.calledBy.get(ticket.id) ?? [];
      list.push(index);
      this.log.calledBy.set(ticket.id, list);
      if (!this.log.callSentAt.has(ticket.id)) {
        this.log.callSentAt.set(ticket.id, sentAt);
        for (const t1 of this.log.displayArrivals.get(ticket.id) ?? []) this.log.callToDisplayMs.push(t1 - sentAt);
        this.log.displayArrivals.delete(ticket.id);
      }
      await sleep(rnd(0.5, 1.5) * p.walkSec * 1000);
      const started = await c.call("start", "POST", `/api/v1/queue/tickets/${ticket.id}/actions`, { json: { action: "start" } });
      if (started.status !== 200) {
        holding = null;
        continue;
      }
      await sleep(rnd(0.4, 1.6) * p.serviceMeanSec * 1000);
      const done = await c.call("complete", "POST", `/api/v1/queue/tickets/${ticket.id}/actions`, {
        json: { action: "complete", outcome: "resolved" },
      });
      if (done.status === 200) this.log.completed.add(ticket.id);
      holding = null;
    }
    void branchId;
    await c.call("agent-status", "POST", "/api/v1/queue/agent/status", { json: { status: "OFFLINE" }, quiet: true });
  }

  /** Waiting-room screens: paired devices on a socket, refetching /display/state after events. */
  async displays() {
    const p = this.profile;
    const branchId = this.ids.branchId;
    for (let i = 1; i <= p.displays; i++) {
      const created = await this.admin.call("setup", "POST", "/api/v1/admin/displays", {
        json: { name: `Load screen ${i}`, branchId, layout: i % 3 === 0 ? "multi" : "classic", config: {} },
        quiet: true,
      });
      if (created.status !== 200 && created.status !== 201)
        throw new Error(`display ${i}: ${created.status} ${JSON.stringify(created.body)}`);
      const tv = this.http.client(`display-${i}`);
      const paired = await tv.call("display-pair", "POST", "/api/v1/public/display/pair", {
        json: { code: created.body.pairingCode },
      });
      if (paired.status !== 200) throw new Error(`pair ${i}: ${paired.status} ${JSON.stringify(paired.body)}`);
      const token: string = paired.body.token;
      const s = this.socketFor(tv, "display", token);
      const refetch = debounced(() =>
        tv.call("display-state", "GET", "/api/v1/display/state", { headers: { authorization: `Bearer ${token}` } }),
      );
      s.on("queue.updated", refetch);
      s.on("ticket.called", (e: { ticketId: string }) => {
        const t1 = this.now();
        const t0 = this.log.callSentAt.get(e.ticketId);
        // The event is published before the HTTP response returns, so the sender may not have registered the call yet:
        // keep the arrival and let the sender finish the measurement.
        if (t0 !== undefined) this.log.callToDisplayMs.push(t1 - t0);
        else (this.log.displayArrivals.get(e.ticketId) ?? this.log.displayArrivals.set(e.ticketId, []).get(e.ticketId)!).push(t1);
        refetch();
      });
      void tv.call("display-state", "GET", "/api/v1/display/state", { headers: { authorization: `Bearer ${token}` } });
    }
  }

  /** Wallboards / live views: a supervisor's screens on /reports/live, refreshed on every event. */
  async wallboards() {
    const branchId = this.ids.branchId;
    for (let i = 1; i <= this.profile.wallboards; i++) {
      const w = await this.http.client(`wallboard-${i}`).login(SUPERVISOR.email, SUPERVISOR.password);
      const s = this.socketFor(w, "staff");
      this.subscribe(s);
      const refetch = debounced(() => w.call("wallboard-live", "GET", `/api/v1/reports/live?branchId=${branchId}`));
      s.on("queue.updated", refetch);
      s.on("ticket.called", refetch);
      s.on("agent.updated", refetch);
      s.on("alert.raised", refetch);
      void w.call("wallboard-live", "GET", `/api/v1/reports/live?branchId=${branchId}`);
    }
  }

  /** Visitors' phones: open the page once, then poll the status every ~10 s like the real page. */
  async visitors() {
    const p = this.profile;
    for (let i = 0; i < p.visitors; i++) {
      const phone = this.http.client(`visitor-${i}`);
      void (async () => {
        await sleep(rnd(0, 10_000)); // not in lock step
        let token: string | null = null;
        while (this.running) {
          if (!token) {
            // Pick one of the recent tickets (someone who just took a number).
            const recent = this.log.issued.slice(-60);
            if (recent.length) {
              token = recent[Math.floor(Math.random() * recent.length)].token;
              await phone.call("visitor-page", "GET", `/t/${token}`, { raw: true });
            } else {
              await sleep(500);
              continue;
            }
          }
          const r = await phone.call("visitor-poll", "GET", `/api/v1/public/tickets/${token}`);
          if (r.status === 200 && ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(r.body.status)) token = null;
          await sleep(10_000 * rnd(0.9, 1.1));
        }
      })();
    }
  }

  /** The manager: opens the report every few seconds; one CSV export halfway. */
  async reports() {
    const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
    const q = `from=${day(-1)}&to=${day(1)}&branchId=${this.ids.branchId}`;
    let n = 0;
    const timer = setInterval(() => {
      if (!this.running) return;
      void this.admin.call("reports-overview", "GET", `/api/v1/reports/overview?${q}`);
      if (++n % 6 === 0)
        void this.admin.call("reports-export-csv", "GET", `/api/v1/reports/export?format=csv&locale=ar&${q}`, { raw: true });
    }, this.profile.reportEverySec * 1000);
    this.timers.push(timer);
  }

  /** Cheap health probe twice a second: its latency shows event-loop and connection-pool pressure from the outside. */
  health() {
    const probe = this.http.client("health");
    const timer = setInterval(() => {
      if (this.running) void probe.call("health", "GET", "/api/health");
    }, 500);
    this.timers.push(timer);
  }

  // ─── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The first request to each route makes the production server load that route's code (seconds on a busy PC). A real
   * install pays that once after a restart; the measured period should not. So every kind of call is made once, not
   * recorded: two tickets go through the whole life cycle, the reports and the status pages are opened.
   */
  private async warmUp() {
    const branchId = this.ids.branchId;
    const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
    const q = `from=${day(-1)}&to=${day(1)}&branchId=${branchId}`;
    const rec = await this.http.client("warm-reception").login(RECEPTION.email, RECEPTION.password);
    const agent = this.agentClients[0];
    await Promise.all([
      this.admin.call("warm", "GET", `/api/v1/reports/overview?${q}`, { quiet: true }),
      this.admin.call("warm", "GET", `/api/v1/reports/live?branchId=${branchId}`, { quiet: true }),
      this.admin.call("warm", "GET", `/api/v1/reports/export?format=csv&locale=ar&${q}`, { quiet: true, raw: true }),
      rec.call("warm", "GET", `/api/v1/queue/state?branchId=${branchId}`, { quiet: true }),
      rec.call("warm", "GET", `/api/v1/queue/reception?branchId=${branchId}`, { quiet: true }),
      this.http.client("warm").call("warm", "GET", "/api/health", { quiet: true }),
    ]);
    await agent.call("warm", "POST", "/api/v1/queue/agent/status", { json: { status: "AVAILABLE" }, quiet: true });
    await agent.call("warm", "GET", "/api/v1/queue/agent", { quiet: true });
    for (let i = 0; i < 3; i++) {
      const { reasonCode, body } = this.ticketRequest(-1 - i);
      const r = await rec.call("warm", "POST", "/api/v1/queue/tickets", { json: body, quiet: true });
      if (r.status !== 200 && r.status !== 201) throw new Error(`warm-up issue failed: ${r.status} ${JSON.stringify(r.body)}`);
      const t = r.body.ticket;
      this.log.issued.push({ id: t.id, token: t.publicToken, displayNumber: t.displayNumber, reasonCode, issuedAt: Date.now() });
      await this.http.client("warm").call("warm", "GET", `/t/${t.publicToken}`, { quiet: true, raw: true });
      await this.http.client("warm").call("warm", "GET", `/api/v1/public/tickets/${t.publicToken}`, { quiet: true });
      const called = await agent.call("warm", "POST", "/api/v1/queue/call-next", { json: {}, quiet: true });
      if (called.body?.ticket) {
        const id = called.body.ticket.id;
        await agent.call("warm", "POST", `/api/v1/queue/tickets/${id}/actions`, { json: { action: "start" }, quiet: true });
        const done = await agent.call("warm", "POST", `/api/v1/queue/tickets/${id}/actions`, {
          json: { action: "complete", outcome: "resolved" },
          quiet: true,
        });
        if (done.status === 200) this.log.completed.add(id);
      }
    }
    await agent.call("warm", "POST", "/api/v1/queue/agent/status", { json: { status: "OFFLINE" }, quiet: true });
  }

  /** Runs everything and resolves when the reception stopped and the agents cleared the queue (or the drain time ran out). */
  async run(): Promise<{ drained: boolean; loadSeconds: number; drainSeconds: number }> {
    const p = this.profile;
    await this.displays();
    await this.wallboards();
    await this.warmUp();
    this.health();
    const agentRuns = this.agentClients.map((_, i) => this.agentLoop(i));
    await sleep(1500); // agents are signed in before the first visitor arrives
    this.http.recording = true;
    this.measuredFrom = new Date().toISOString();
    await this.visitors();
    await this.reports();
    const t0 = this.now();
    await this.receptionLoop();
    const loadSeconds = (this.now() - t0) / 1000;
    const drainStart = this.now();
    const deadline = drainStart + p.drainSec * 1000;
    while (this.now() < deadline && this.log.completed.size < this.log.issued.length) await sleep(500);
    const drained = this.log.completed.size >= this.log.issued.length;
    const drainSeconds = (this.now() - drainStart) / 1000;
    this.running = false;
    await Promise.race([Promise.allSettled(agentRuns), sleep(15_000)]);
    return { drained, loadSeconds, drainSeconds };
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    for (const s of this.sockets) s.close();
    this.http.destroy();
  }

  /** Delivery latency summary for the Socket.IO check. */
  deliverySummary() {
    const l = [...this.log.callToDisplayMs].sort((a, b) => a - b);
    return {
      samples: l.length,
      p50: percentile(l, 50),
      p95: percentile(l, 95),
      p99: percentile(l, 99),
      max: l.length ? l[l.length - 1] : 0,
    };
  }
}
