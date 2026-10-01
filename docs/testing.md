# Testing

Four layers, from fast and narrow to slow and broad. Each has its own command and, where it needs a database, its own
throw-away database, so no test can ever touch your working data.

| Layer       | Folder / tool                             | What it proves                                                                                                                | Needs                            | Command                                   |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| Unit        | `tests/unit` (Vitest)                     | Pure rules: ticket state machine, distribution scoring, Arabic folding, RBAC, report maths                                    | nothing                          | `npm run test:unit`                       |
| Integration | `tests/integration` (Vitest)              | Services against a real PostgreSQL: queue engine, auth, reports, exports, notifications                                       | PostgreSQL, database `<db>_test` | `npm test`                                |
| End-to-end  | `tests/e2e` (Playwright, Chromium)        | The real screens in a real browser against a real server: login, reception, agent, visitor, display, settings, reports, roles | PostgreSQL, a production build   | `npm run test:e2e`                        |
| Load        | `scripts/load` (Node, `socket.io-client`) | Latency, errors, realtime delivery, memory and queue correctness under a busy morning                                         | PostgreSQL, a production build   | `npm run load:smoke`, `npm run load:full` |

`npm test` runs unit and integration together (Vitest picks up only `tests/unit` and `tests/integration`; Playwright
specs and the load scripts are outside its globs). Lint, typecheck and format checks are separate (`npm run lint`,
`npm run typecheck`, `npm run format:check`).

## The hermetic database approach

Every layer that writes data uses a database of its own, and refuses to run on any other:

| Layer       | Database                                                                  | Created by                                         | Safety check                                    |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Integration | `TEST_DATABASE_URL`, default `<db>_test`                                  | the tests (`prepareTestDatabase`)                  | name must end in `_test` (`tests/setup-env.ts`) |
| End-to-end  | `E2E_DATABASE_URL`, default `postgres://dor:dor@localhost:5433/dor_e2e`   | global setup, **dropped and re-created every run** | name must end in `_e2e` or `_load`              |
| Load        | `LOAD_DATABASE_URL`, default `postgres://dor:dor@localhost:5433/dor_load` | the runner, dropped and re-created every run       | same                                            |

The default host `localhost:5433` is the PostgreSQL bundled with `npm run local` (start it alone with
`npm run local -- --db`). In CI point the variables at the Postgres service (`localhost:5432`, user `dor`, password
`dor`); the user must be allowed to create databases. Ports follow the same rule: the end-to-end suite runs its own
app on **3200**, the load test on **3201**, and both refuse port 3000 (your development app). They never share data,
sessions or build output with it.

### What the end-to-end global setup does

`tests/e2e/global-setup.ts` (shared code in `scripts/lib/harness.ts`):

1. **Build.** With `E2E_DIST_DIR=<dir>` it uses that finished production build as it is (CI builds once with
   `npm run build` and passes `.next`). Without it, it makes a production build of its own in `.next-e2e` (git-ignored)
   and rebuilds it only when something under `src`, `messages`, `public` or the build configuration is newer than the
   last build. A production build starts and runs much faster than development mode (no per-page compilation), which is
   what makes a browser suite of this size practical; the cost is the build, one to five minutes depending on the machine.
2. **Database.** Drops and creates `dor_e2e`, applies the migrations, and seeds the demo organization (the same data as
   `npm run db:seed`: `admin@dor.local`, `reception@dor.local`, `khalid@dor.local`, ... with password `Dor@Demo2026`).
3. **App.** Starts `server.ts` in production mode on port 3200 with `MESSAGING_MOCK=true` (messages are recorded, never
   sent), fixed test keys, and the output in `test-results/e2e-server.log`; waits for `/api/health`.
4. **Teardown.** Stops the app and drops the database (set `E2E_KEEP=1` to keep it for inspection).

For quick iteration you can start an instance yourself and point the suite at it: `E2E_BASE_URL=http://localhost:3200
npx playwright test 02-` (the global setup then does nothing). Tests leave the shared data in a usable state but do not
reset it, so a re-run against the same instance sees earlier tickets; the hermetic mode starts from nothing every time.

### Running the end-to-end suite

```bash
npm run local -- --db        # once, in another terminal, if no PostgreSQL is running
npm run test:e2e             # everything; HTML report in playwright-report/ on CI
npx playwright test 06-      # one file
npx playwright test --headed --workers=1 --debug 02-
npx playwright show-trace test-results/e2e/<test>/trace.zip   # after a failure
```

First time on a machine: `npx playwright install chromium`. Failures keep a screenshot and a trace in
`test-results/e2e/` (git-ignored); CI retries a failed test once. The suite uses one worker because all tests share one
database and one app; files run in numeric order (`01-` to `08-`) and each scenario starts with `cleanSlate()`, which
cancels open tickets, signs the agents out and switches shift enforcement off (so no scenario depends on the time of
day).

| File                         | Scenario                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `01-auth.spec.ts`            | Login (wrong password, then the right one), logout, protected pages redirect; the same flow in English, left to right                    |
| `02-visit-lifecycle.spec.ts` | Reception one tap, agent available, call, start, complete with an outcome, the visitor page in each state, rating, report shows it       |
| `03-distribution.spec.ts`    | Push mode, two agents, three tickets: one reserved ticket per agent, nobody holds two, the third goes to the first free agent            |
| `04-display.spec.ts`         | Admin adds a screen, the TV pairs with the code (and rejects a wrong one), the called number appears live, light and dark themes, revoke |
| `05-breaks.spec.ts`          | Two agents on break, the third is queued and told so, then offered the place when a colleague returns                                    |
| `06-admin.spec.ts`           | Create a user in the dialog, settings search / section / save bar / discard, logo upload (generated PNG), dark-mode toggle               |
| `07-reports.spec.ts`         | The reports page loads data and charts, the download dialog exports one section as CSV and the file content is checked                   |
| `08-roles.spec.ts`           | A city admin cannot see or reach the other city's branch; an agent and a receptionist get the forbidden screen where they should         |

### Writing end-to-end tests here

- **Locate by the shipped wording.** `support.ts` loads `messages/ar.json` and `messages/en.json`, so a test says
  `ar("agent.callNext")` and keeps working when the sentence is reworded. Prefer roles and labels; the suite needed no
  `data-testid` attributes. Text that comes from the demo seed (`استفسار عام`, branch names) is written literally.
- **Set up through the API, assert through the screen.** `Api`, `as(email)`, `issueTicket`, `facts()` (ids of the branch,
  reasons and users) and `signedIn(browser, email)` are in `support.ts`. Browser sessions reuse the cookie of one API
  login per account (the login endpoint allows 20 per minute per address).
- **Wait for state, never for time.** Realtime is asserted with `expect.poll(() => api state)` or with a web-first
  `expect(locator)`; there are no fixed sleeps. The visitor page polls every 10 s on its own, so tests reload it.
- **Keep scenarios independent.** Start with `cleanSlate()`, restore any setting you change (the admin spec puts the
  branding back), and use unique names for things you create.
- **No time-of-day assumptions.** The product has no hours, pauses or holidays (decisions D29, D30); a test must not
  need a particular time to pass.

## Load tests

`npm run load:smoke` (about 2 minutes: 30 s of load plus set-up and clearing the queue) and `npm run load:full`
(5 minutes of load) run the "busy morning" scenario described in [load-testing.md](load-testing.md), which also holds
the measured numbers, thresholds and tuning notes. They start their own app on port 3201 against `dor_load`, or run
against `BASE_URL` (see that document for the safeguards), write `load-results/*.json` and `*.md` (git-ignored) and
exit with status 1 when a threshold or a queue invariant fails.

## Integration and unit tests

Unchanged: `tests/integration` files share one database and run sequentially (`fileParallelism: false` in
`vitest.config.mts`); each file calls `prepareTestDatabase()` and `resetDemo()` (`tests/integration/fixtures.ts`) for a
fresh demo organization and builds actors with `actorFor("khalid@dor.local")` instead of logging in. Without a
reachable PostgreSQL the integration tests skip themselves locally and fail in CI (`CI=true`).

## Troubleshooting

| Symptom                                           | Cause and fix                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Postgres is not reachable at localhost:5433"     | Start it: `npm run local -- --db` (or set `E2E_DATABASE_URL`)                                                             |
| Setup stalls at "building the production version" | Normal after code changes; the build is cached in `.next-e2e` until the sources change again                              |
| "the app exited while starting"                   | The log tail is in the message; usually a half-finished edit or a migration problem. Fix and re-run                       |
| A test passes alone but fails in the full run     | It depends on leftover state: begin it with `cleanSlate()` and use unique names                                           |
| Everything times out on a loaded machine          | Per-test limit is 120 s (`playwright.config.ts`); the load tests accept `LOAD_THRESHOLD_FACTOR=2` to relax latency limits |
