# Load testing

`npm run load:smoke` and `npm run load:full` simulate a busy morning at one branch and check that the system stays fast,
that realtime reaches the screens, and (the part that matters most) that the queue stays correct. Code: `scripts/load`.
Results go to `load-results/` (git-ignored) as JSON and Markdown; the exit code is 1 when a threshold or an invariant fails.

## The scenario

| Part                    | Smoke (default)  | Full (default)            | Behaviour                                                                                                                                                  |
| ----------------------- | ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agents                  | 5                | 20                        | Own accounts, desks and a group assigned to three reasons. Available, then call next, walk 1-1.5 s, start, serve (uniform 0.4x-1.6x of the mean), complete |
| Reception               | 45 tickets/min   | 120 tickets/min           | Poisson arrivals, 30 s / 300 s; half general, a quarter documents, a quarter complaints (phone and consent, so notifications fire); 5 % VIP                |
| Visitors' phones        | 20               | 200                       | Open `/t/<token>` once, then poll `/api/v1/public/tickets/<token>` every 10 s, each with its own address                                                   |
| Waiting-room screens    | 3                | 30                        | Paired devices on a Socket.IO connection; refetch `/display/state` after each event                                                                        |
| Wallboards              | 2                | 10                        | Supervisor session on a socket; refetch `/reports/live` after each event                                                                                   |
| Manager                 | report every 3 s | every 5 s                 | `/reports/overview`, and a CSV export every sixth time                                                                                                     |
| History in the database | none             | 100 000 completed tickets | Spread over 300 days (`LOAD_HISTORY`), so scans of old data show up                                                                                        |
| Notifications           | mock provider    | mock provider             | Real outbox and pg-boss worker; `MESSAGING_MOCK=true`                                                                                                      |

Every simulated screen uses the same calls and the same refetch rule as the real ones (150 ms debounce, never two
refetches of one query in flight): this fan-out is the real load, one ticket event makes every screen of the branch ask
for fresh data. A warm-up (one pass over every kind of call, three tickets through the whole life cycle) runs before the
measured period, because the production server loads each route's code on its first request.

## Running

```bash
npm run local -- --db                       # PostgreSQL on localhost:5433, if not running
npm run load:smoke                          # about 1.5 minutes in total
npm run load:full                           # about 12 minutes (1 minute of history, 5 of load, the queue clearing, checks)
LOAD_DURATION=60 LOAD_HISTORY=20000 npm run load:full     # a shortened full run
```

By default the runner builds (or reuses `.next-e2e`, see testing.md), re-creates database `dor_load`, starts its own app on
port 3201 with `TRUST_PROXY=true` (every simulated client sends its own `X-Forwarded-For`, otherwise 200 phones would
share one rate-limit bucket) and a small preload (`scripts/load/probe.mjs`) that samples event-loop delay, memory and the
PostgreSQL pool inside the app once a second, without changing application code.

Against an instance you started: `BASE_URL=http://host:3001 LOAD_CONFIRM_THROWAWAY=yes LOAD_DATABASE_URL=... npm run
load:smoke`. That **creates agents, desks, displays and thousands of tickets in it**, replaces the reason assignments, and
needs `TRUST_PROXY=true` there; the in-process probe is not available. Port 3000 is refused.

Settings: `LOAD_AGENTS`, `LOAD_RATE` (per minute), `LOAD_DURATION`, `LOAD_DRAIN` (seconds allowed to clear the queue),
`LOAD_VISITORS`, `LOAD_DISPLAYS`, `LOAD_WALLBOARDS`, `LOAD_SERVICE_SEC`, `LOAD_MODE=pull|push`, `LOAD_HISTORY`,
`LOAD_THRESHOLD_FACTOR`, `LOAD_MAX_RSS_GROWTH_MB`, `LOAD_KEEP=1`, `LOAD_PORT`, `LOAD_DATABASE_URL`, `DATABASE_POOL_MAX`
(passed to the app).

## Pass thresholds

| Check                                        | Limit                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| p95 issue, call next, start, complete        | 500 ms                                                                                 |
| p95 every other endpoint                     | 1000 ms (visitor page 2 s, health 500 ms, CSV export 5 s)                              |
| Error rate (failed or rate-limited requests) | below 0.5 %                                                                            |
| Sockets                                      | all connect; p95 from the call request to the screens' `ticket.called` at most 1000 ms |
| Event-loop lag                               | 95th percentile of the per-second p99 at most 250 ms                                   |
| RSS growth after warm-up                     | at most 300 MB                                                                         |
| Invariants                                   | all hold (below)                                                                       |

The smoke profile multiplies the latency limits by 5 (`LOAD_THRESHOLD_FACTOR`): it is a regression gate for CI runners of
unknown speed (correctness invariants and gross slowdowns), not a measurement. The full profile is judged against the limits above.

**Invariants** (read from the database after the queue clears): no lost tickets (every ticket a client was given exists,
nothing else does); no ticket handed to two agents (client view and the `CALLED` events); no agent holds two visitors at
once; numbers unique and gap-free per branch, service day and prefix; every ticket completed exactly once and the event
log agrees (`ISSUED`, `STARTED`, `COMPLETED` counts); notifications all settled (none queued, none failed, no duplicate
dedupe keys).

## Measured numbers

Hardware: the Windows development PC, 13th Gen Intel i5-13420H (12 threads), 16 GB RAM, Node 24, embedded PostgreSQL 18 on
the same machine, production build, one app process. **The PC was shared with other work throughout** (builds and test
runs of other tasks kept it at about 50 % CPU and under 3 GB free memory), and the load generator ran on it too, so
treat every figure as pessimistic and noisy: repeated smoke runs differed by a factor of two to ten.

### Smoke (5 agents, 45 tickets/min, 30 s), a passing run

34 tickets issued and completed, queue clear 4 s after the load stopped. Invariants: all hold.

| Endpoint      | Requests | p50 ms | p95 ms | p99 ms |
| ------------- | -------: | -----: | -----: | -----: |
| issue         |       31 |    189 |    543 |    730 |
| call-next     |       78 |     87 |    610 |   1065 |
| start         |       31 |    175 |    542 |    771 |
| complete      |       31 |    150 |    419 |    716 |
| agent-state   |      230 |    321 |    583 |    740 |
| display-state |      141 |    287 |    539 |    704 |
| visitor-poll  |       68 |     26 |    180 |    285 |
| health        |       69 |     17 |     52 |     83 |

Event-loop delay mean 15 ms, p99 per second 68 ms (worst 70 ms); RSS 517 to 782 MB; pool up to 20 of 20 connections,
saturated in 8 % of the seconds. Other smoke runs on the same machine, with the same code, gave p95 for issue between
0.5 s and 3 s, and one run timed out requests after 30 s while the machine was busy.

### Full, shortened to 60 s of load (20 agents, 120/min, 200 phones, 30 screens, 10 wallboards, 100 000 tickets of history)

Not passed on this machine. 124 tickets issued, 110 completed when the 120 s clearing time ended. All queue invariants
held (no lost, duplicated or double-assigned ticket, numbering gap-free); the "all notifications settled" check failed
because the worker was behind (39 sent, 27 still queued) and the p95 limits failed:

| Endpoint         | Requests |        p95 ms |
| ---------------- | -------: | ------------: |
| issue            |      121 |         14201 |
| call-next        |      122 |         11536 |
| start / complete | 114 each | 15900 / 17873 |
| agent-state      |     1729 |          6135 |
| display-state    |     1279 |         15697 |
| visitor-poll     |     2282 |         12481 |
| health           |      396 |          3749 |

Event-loop delay mean 32 ms, 95th percentile of p99 261 ms, worst 1.5 s. Pool: 20 of 20 connections in use in 78 % of
the seconds, up to 818 queries waiting for a connection. Memory stayed bounded (peak 1.15 GB RSS, including the waiting
requests). A first version of the simulation that let screens start a new refetch while one was still in flight (the
real screens do not) collapsed completely (p95 above 2 minutes); the single-flight rule in the simulation matters.

## Findings and tuning

1. **The bottleneck is PostgreSQL work per queue event, not the Node event loop.** The event loop stays healthy (mean
   15-33 ms); what grows is the number of queries waiting for one of the 20 pool connections. Each queue mutation takes
   a per-branch advisory lock and then reads the whole branch context (about 20 statements), and every event makes every
   screen of the branch refetch (agent workspace, display state, wallboard, reception: 3 to 20 statements each). With 20
   agents, 30 screens and 10 wallboards one event triggers about 60 refetches.
2. **A larger pool does not help.** `DATABASE_POOL_MAX=60` in the same full run made mutations worse (call next, issue and
   complete timed out at 30 s): mutations waiting for the branch lock hold their connections, and more concurrent
   statements only compete for the same CPU. Keep the default of 20 on a single PostgreSQL; the lever is fewer queries.
3. **History is not the cause.** Single requests on a database with 100 000 earlier tickets are as fast as on an empty one
   (issue 71 ms, agent state 76 ms, reception 68 ms idle); the heavy statements are index-backed. Two items to watch
   when volumes grow: the wait-time model re-reads up to 50 000 finished services per branch every 5 minutes inside a
   branch-locked transaction (a sequential scan, 60-170 ms at 100 000 tickets; an index on `(branch_id, finished_at)`
   would help), and the report overview (279 ms with this history, scanning the period).
4. **Ideas, not done** (each changes behaviour or architecture, so they need a decision rather than a quiet fix): share one
   computed `/display/state` among the screens of a branch for a fraction of a second (coalescing must run a fresh
   computation after each event, or a screen can miss an update); send the changed ticket in the event instead of making
   every screen refetch; read-only queries on a replica or at least outside the branch lock; raise the debounce of
   wallboard and display refetches to 500 ms.
5. **Sizing from these runs:** the smoke profile (5 agents, 45 tickets/min, a few screens) is comfortable even on a loaded
   PC; the full profile (about three times the agents and ten times the screens) needs a machine with CPU to spare for
   PostgreSQL next to the app, not a shared PC. Re-run `load:full` on the target server hardware before committing to
   branch sizes; the numbers in this file are the baseline to compare against.
6. **No migration was added.** No missing index was found that explained the latency, so migration `0015` was not used.
