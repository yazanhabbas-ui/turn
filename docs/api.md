# REST API (v1)

Base path: `/api/v1`. JSON in and out. All responses carry `Cache-Control: no-store`.

## Authentication

- **Browser sessions:** `dor_session` cookie (HttpOnly, SameSite=Lax), set by `POST /auth/login`.
- **CSRF:** mutating requests (`POST/PUT/PATCH/DELETE`) must send an `Origin` or `Referer` header matching the server's host or `APP_URL`. Otherwise they get `403 bad_origin`. Browsers do this automatically.
- **Displays:** long-lived device token (display milestone).
- **Integrations:** `Authorization: Bearer <api key>` (hardening milestone).

## Errors

```json
{ "error": { "code": "validation", "details": { "issues": [{ "path": ["email"], "code": "invalid_format", "message": "…" }] } } }
```

| Code                                                      | HTTP | Meaning                                          |
| --------------------------------------------------------- | ---- | ------------------------------------------------ |
| `validation`                                              | 400  | Body failed schema validation                    |
| `unauthorized`                                            | 401  | No valid session                                 |
| `totp_required`                                           | 401  | Session is waiting for the 2FA step              |
| `invalid_credentials`                                     | 401  | Wrong email or password (same for unknown users) |
| `forbidden`, `bad_origin`                                 | 403  | Missing permission / cross-origin mutation       |
| `not_found`                                               | 404  |                                                  |
| `conflict`, `invalid_transition`                          | 409  | Concurrent change / illegal ticket state change  |
| `account_locked`                                          | 423  | `details.minutes` until unlock                   |
| `rate_limited`                                            | 429  | `Retry-After` header                             |
| `weak_password`                                           | 400  | `details.issues[]`, `details.minLength`          |
| `wrong_password`, `invalid_code`, `organization_required` | 400  |                                                  |
| `server_error`                                            | 500  | Logged server-side; no details leaked            |

## Endpoints

### Health

| Method | Path          | Auth | Response                                                                           |
| ------ | ------------- | ---- | ---------------------------------------------------------------------------------- |
| GET    | `/api/health` | none | `200 {status:"ok", database:"ok", version, uptimeSeconds, time}` or `503 degraded` |

### Auth

| Method | Path                 | Auth        | Body                               | Notes                                                                         |
| ------ | -------------------- | ----------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/auth/login`        | public      | `{email, password, organization?}` | Sets the cookie. `{status:"ok"}` or `{status:"totp_required"}`. 20/min per IP |
| POST   | `/auth/totp/verify`  | pending 2FA | `{code}`                           | Completes sign-in. Eastern Arabic digits accepted. 10/min per user            |
| POST   | `/auth/logout`       | any         | `{}`                               | Deletes the session and clears the cookie                                     |
| GET    | `/auth/me`           | pending 2FA |                                    | `{user, twoFactorVerified, grants[]}`                                         |
| POST   | `/auth/password`     | session     | `{currentPassword, newPassword}`   | Enforces the policy, signs out other sessions, re-issues the cookie           |
| POST   | `/auth/totp/setup`   | session     | `{}`                               | `{qrDataUrl, secret}` (QR rendered server-side)                               |
| POST   | `/auth/totp/enable`  | session     | `{code}`                           | Confirms enrolment                                                            |
| POST   | `/auth/totp/disable` | session     | `{password}`                       |                                                                               |
| POST   | `/auth/locale`       | session     | `{locale}`                         | Saves the preferred UI language                                               |

### Public (no session)

| Method | Path                            | Body                              | Notes                                                                                       |
| ------ | ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/public/invites/:token`        |                                   | `{email, displayName, roleName, organizationName, locale, expiresAt}` or `404`              |
| POST   | `/public/invites/:token`        | `{displayName, password, email?}` | Creates the user with the invited role/branch (single use) and signs them in. 30/min per IP |
| GET    | `/public/password-reset/:token` |                                   | `{email, displayName}` or `404`                                                             |
| POST   | `/public/password-reset/:token` | `{password}`                      | Sets the password, signs out all sessions                                                   |

### Admin

Every admin endpoint requires a signed-in user. The permission shown is checked first. Services then check branch scope: a grant limited to one branch only acts on that branch. All changes are written to the audit log. Localized fields are `{ "ar": "…", "en": "…" }`, and Arabic or English is required.

| Method             | Path                                        | Permission                                         | Notes                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET                | `/admin/lookups`                            | admin.access                                       | Branches (with floors and desks), roles, agents, groups, priorities and break types for pickers                                                                                                        |
| GET / POST         | `/admin/users`                              | users.view / users.manage                          | Filters: `q` (Arabic-normalized and transliterated name search), `roleId`, `branchId`, `status`. POST without `password` returns `setPasswordLink`                                                     |
| PUT                | `/admin/users/:id`                          | users.manage                                       | `{email, displayName, phone, locale, grants[{roleId, branchId}], agent{branchId, defaultDeskId, maxConcurrent, weight} or null, groupIds}`                                                             |
| POST               | `/admin/users/:id/actions`                  | users.manage                                       | `{action: activate, deactivate, force_logout, reset_2fa}` or `{action: "reset_password", sendEmail}` → `{link, expiresAt}`                                                                             |
| GET / POST         | `/admin/roles`                              | roles.view / roles.manage                          | `{name, description, permissions[]}`. You cannot grant permissions you do not hold (`forbidden/escalation`)                                                                                            |
| PUT / DELETE       | `/admin/roles/:id`                          | roles.manage                                       | Built-in roles return `409 system_role`. DELETE archives and returns `409 role_in_use` while users still hold the role                                                                                 |
| POST               | `/admin/roles/:id/clone`                    | roles.manage                                       | `{name}`                                                                                                                                                                                               |
| GET / POST         | `/admin/invites`                            | users.invite                                       | `{email?, phone?, displayName?, roleId, branchId, channels[email, whatsapp, sms], locale}` → `{link, expiresAt, deliveries[]}`                                                                         |
| POST / DELETE      | `/admin/invites/:id`                        | users.invite                                       | POST resends: rotates the token (the old link stops working). DELETE revokes                                                                                                                           |
| GET / POST         | `/admin/branches`                           | admin.access / branches.manage (organization-wide) | A new branch gets a queue for every active reason                                                                                                                                                      |
| PUT / DELETE       | `/admin/branches/:id`                       | branches.manage                                    | DELETE archives; the last branch cannot be archived                                                                                                                                                    |
| POST               | `/admin/branches/:id/floors`, `/desks`      | branches.manage                                    | Desk `number` is unique per branch among active desks                                                                                                                                                  |
| PUT / DELETE       | `/admin/floors/:id`, `/admin/desks/:id`     | branches.manage                                    | DELETE archives                                                                                                                                                                                        |
| GET / POST         | `/admin/reasons`                            | reasons.view / reasons.manage                      | `?archived=true` includes archived reasons. Unique `code` and `shortcutKey`                                                                                                                            |
| PUT / PATCH        | `/admin/reasons/:id`                        | reasons.manage                                     | PATCH `{archived}` archives or restores (never deletes)                                                                                                                                                |
| PUT                | `/admin/reasons/:id/assignments`            | reasons.manage                                     | Full list `[{userId or groupId, branchId?, proficiency 1-5, isPrimary}]`                                                                                                                               |
| GET / POST         | `/admin/groups`, PUT / DELETE `/:id`        | reasons.view / reasons.manage                      | `{name, branchId?, supervisorUserId?, memberIds[]}`                                                                                                                                                    |
| POST, PUT / DELETE | `/admin/priority-levels[/:id]`              | distribution.manage                                | `normal` cannot be archived                                                                                                                                                                            |
| POST, PUT / DELETE | `/admin/break-types[/:id]`                  | settings.manage                                    |                                                                                                                                                                                                        |
| GET / POST         | `/admin/displays`, PUT / DELETE `/:id`      | displays.manage                                    | Waiting-room screens. POST returns `{id, pairingCode, pairingExpiresAt}`. Config: `{languages, rotateSeconds, zones, showTicker, showSlides, showWaiting, showClock, voice{enabled?, volume?, rate?}}` |
| POST               | `/admin/displays/:id/pairing`               | displays.manage                                    | New single-use pairing code (valid 15 minutes)                                                                                                                                                         |
| POST               | `/admin/displays/:id/revoke`                | displays.manage                                    | Kills the device token and disconnects the screen at once                                                                                                                                              |
| GET / POST         | `/admin/announcements`, PUT / DELETE `/:id` | announcements.manage                               | Ticker lines and slides (`kind`, localized `body`, local `mediaUrl` only, schedule window, sort order)                                                                                                 |
| GET / PUT          | `/admin/templates`                          | templates.manage                                   | Editable phrases per channel and event; PUT upserts `{channel, event, subject?, body{ar,en}, isActive}`. Voice placeholders: {ticket} {desk} {agent} {reason}                                          |
| GET / POST         | `/admin/audio-packs`, PUT / DELETE `/:id`   | templates.manage                                   | Pre-recorded voice clips: `{locale, name, manifest{"ar.digit.7": "/audio/7.mp3", …}}`                                                                                                                  |
| GET                | `/admin/settings`                           | admin.access                                       | All resolved setting groups (defaults, then organization, then `?branchId`)                                                                                                                            |
| PUT                | `/admin/settings/:key`                      | settings.manage (organization-wide)                | Keys: `branding`, `regional`, `ticketing`, `security`, `privacy`, `visitorStatus`                                                                                                                      |
| GET                | `/admin/audit`                              | audit.view                                         | `entityType`, `actorUserId`, `from`, `to`, `before` (cursor), `limit`. Returns `{items, nextBefore}`                                                                                                   |

### Queue

All queue mutations of a branch run in one transaction under a per-branch advisory lock, with a guarded update (the status and version must be unchanged). Two agents pressing Call next at the same moment can therefore never receive the same ticket. Realtime events are published only after commit.

| Method | Path                                  | Permission                             | Notes                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/queue/tickets`                      | tickets.issue                          | `{branchId, reasonId, priorityKey?, language, fields{…intake}, consent, assignToAgentId?, appointmentId?, source}`. Send an `Idempotency-Key` header. Returns `{ticket, ahead, estimatedWaitMinutes, duplicate}`. Errors: `conflict/closed`, `conflict/cutoff`, `conflict/range_exhausted`, `validation/unexpected_field`, `validation/missing_field`, `validation/consent_required` |
| POST   | `/queue/call-next`                    | agent.serve                            | `{deskId?}`. Returns `{ticket}`, or `{ticket: null, reason: empty, at_capacity or not_working}`. Also sets the agent to AVAILABLE                                                                                                                                                                                                                                                    |
| POST   | `/queue/tickets/:id/actions`          | per action                             | `{action: recall, start, complete{outcome, notes, tags}, no_show, hold, resume, cancel{note}, transfer{toReasonId?, toAgentId?, note}, assign{agentId or null}, check_in, edit{priorityKey, notes, language}, undo}`. An illegal move returns `409 invalid_transition`                                                                                                               |
| POST   | `/queue/agent/status`                 | agent.serve                            | `{status: AVAILABLE, BUSY, ON_BREAK, AWAY or OFFLINE, breakTypeId?, deskId?}`                                                                                                                                                                                                                                                                                                        |
| POST   | `/public/display/pair`                | public (10/min per IP)                 | `{code}` → `{token, displayId, name}`. The token is shown once and only its hash is stored                                                                                                                                                                                                                                                                                           |
| GET    | `/display/state`                      | device token (`Authorization: Bearer`) | Everything a screen renders: desks with current tickets, recent calls, waiting per reason, ticker, slides, voice settings and phrases. No personal data                                                                                                                                                                                                                              |
| GET    | `/queue/state?branchId=&q=`           | tickets.view or agent.serve            | Today's tickets (and older open ones), the waiting order, positions and estimates, agent statuses                                                                                                                                                                                                                                                                                    |
| GET    | `/queue/reception?branchId=`          | tickets.issue                          | Reception console data: branches the user may work in, reasons with waiting counts, priorities, agents, the distribution mode per reason, consent text, ticket print template and branding                                                                                                                                                                                           |
| GET    | `/queue/agent`                        | agent.serve                            | The signed-in agent's workspace: status and break, desks, break types, current (called/serving), reserved and on-hold tickets, per-reason queue counts, other agents (for transfer)                                                                                                                                                                                                  |
| GET    | `/queue/appointments?branchId=&code=` | appointments.checkin                   | Look up a booked appointment by its code. To check it in, POST `/queue/tickets` with its `appointmentId`                                                                                                                                                                                                                                                                             |
| GET    | `/public/tickets/:token`              | public                                 | Visitor status behind the ticket QR: number, status, reason, position and estimate, desk once called. No personal data. 120 requests/min per IP                                                                                                                                                                                                                                      |

**Realtime (Socket.IO):** emit `subscribe {branchId}` (with an ack) to join the branch room. Events:

- `queue.updated` (refetch the state)
- `ticket.called {displayNumber, deskNumber, agentId, reasonId, language, recall}`
- `agent.updated`
- `alert.raised`

### Distribution and simulation

| Method | Path                            | Permission            | Notes                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/distribution-rules`     | distribution.manage   | `{defaults, rules[{id, scope, branchId, queueId, config, version}], queues[]}`                                                                                                                                                                                                                           |
| PUT    | `/admin/distribution-rules`     | distribution.manage   | `{scope: global, branch or queue, branchId?, queueId?, config}`. Validated when merged over the defaults. Applies to the next decision                                                                                                                                                                   |
| DELETE | `/admin/distribution-rules/:id` | distribution.manage   | Removes a branch or queue override (the global rule cannot be removed)                                                                                                                                                                                                                                   |
| POST   | `/admin/simulate`               | distribution.simulate | `{branchId, source: synthetic{total, opensAt, closesAt, vipShare, elderlyShare} or replay{date}, agentIds?, extraAgents, scenarios[{label, useCurrent, config}], seed}`. Returns per-scenario totals (avg, median, P90 and max wait, SLA %), per agent, per reason, fairness, and queue length over time |

Display and report endpoints are added with their milestones.

## Realtime (Socket.IO)

- Path: `/socket.io`. It authenticates with the same session cookie and falls back to long-polling automatically.
- Rooms: `org:<id>`, `user:<id>`. Branch, agent and display rooms, and the event catalogue, come with milestones 4–5.
