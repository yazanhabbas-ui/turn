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

| Method             | Path                                    | Permission                                         | Notes                                                                                                                                              |
| ------------------ | --------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                | `/admin/lookups`                        | admin.access                                       | Branches (with floors and desks), roles, agents, groups, priorities and break types for pickers                                                    |
| GET / POST         | `/admin/users`                          | users.view / users.manage                          | Filters: `q` (Arabic-normalized and transliterated name search), `roleId`, `branchId`, `status`. POST without `password` returns `setPasswordLink` |
| PUT                | `/admin/users/:id`                      | users.manage                                       | `{email, displayName, phone, locale, grants[{roleId, branchId}], agent{branchId, defaultDeskId, maxConcurrent, weight} or null, groupIds}`         |
| POST               | `/admin/users/:id/actions`              | users.manage                                       | `{action: activate, deactivate, force_logout, reset_2fa}` or `{action: "reset_password", sendEmail}` → `{link, expiresAt}`                         |
| GET / POST         | `/admin/roles`                          | roles.view / roles.manage                          | `{name, description, permissions[]}`. You cannot grant permissions you do not hold (`forbidden/escalation`)                                        |
| PUT / DELETE       | `/admin/roles/:id`                      | roles.manage                                       | Built-in roles return `409 system_role`. DELETE archives and returns `409 role_in_use` while users still hold the role                             |
| POST               | `/admin/roles/:id/clone`                | roles.manage                                       | `{name}`                                                                                                                                           |
| GET / POST         | `/admin/invites`                        | users.invite                                       | `{email?, phone?, displayName?, roleId, branchId, channels[email, whatsapp, sms], locale}` → `{link, expiresAt, deliveries[]}`                     |
| POST / DELETE      | `/admin/invites/:id`                    | users.invite                                       | POST resends: rotates the token (the old link stops working). DELETE revokes                                                                       |
| GET / POST         | `/admin/branches`                       | admin.access / branches.manage (organization-wide) | A new branch gets a queue for every active reason                                                                                                  |
| PUT / DELETE       | `/admin/branches/:id`                   | branches.manage                                    | DELETE archives; the last branch cannot be archived                                                                                                |
| POST               | `/admin/branches/:id/floors`, `/desks`  | branches.manage                                    | Desk `number` is unique per branch among active desks                                                                                              |
| PUT / DELETE       | `/admin/floors/:id`, `/admin/desks/:id` | branches.manage                                    | DELETE archives                                                                                                                                    |
| GET / POST         | `/admin/reasons`                        | reasons.view / reasons.manage                      | `?archived=true` includes archived reasons. Unique `code` and `shortcutKey`                                                                        |
| PUT / PATCH        | `/admin/reasons/:id`                    | reasons.manage                                     | PATCH `{archived}` archives or restores (never deletes)                                                                                            |
| PUT                | `/admin/reasons/:id/assignments`        | reasons.manage                                     | Full list `[{userId or groupId, branchId?, proficiency 1-5, isPrimary}]`                                                                           |
| GET / POST         | `/admin/groups`, PUT / DELETE `/:id`    | reasons.view / reasons.manage                      | `{name, branchId?, supervisorUserId?, memberIds[]}`                                                                                                |
| GET / POST         | `/admin/schedules`, PUT / DELETE `/:id` | reasons.view / reasons.manage                      | GET returns `{schedules, pauses, holidays}`. Rules `[{kind: regular or ramadan, weekday, opensAt, closesAt}]`                                      |
| POST, PUT / DELETE | `/admin/pause-windows[/:id]`            | branches.manage                                    | Prayer or custom pauses, with manual times or auto-calculated                                                                                      |
| POST, PUT / DELETE | `/admin/holidays[/:id]`                 | branches.manage                                    |                                                                                                                                                    |
| POST, PUT / DELETE | `/admin/priority-levels[/:id]`          | distribution.manage                                | `normal` cannot be archived                                                                                                                        |
| POST, PUT / DELETE | `/admin/break-types[/:id]`              | settings.manage                                    |                                                                                                                                                    |
| GET                | `/admin/settings`                       | admin.access                                       | All resolved setting groups (defaults, then organization, then `?branchId`)                                                                        |
| PUT                | `/admin/settings/:key`                  | settings.manage (organization-wide)                | Keys: `branding`, `regional`, `ticketing`, `security`, `privacy`, `visitorStatus`                                                                  |
| GET                | `/admin/audit`                          | audit.view                                         | `entityType`, `actorUserId`, `from`, `to`, `before` (cursor), `limit`. Returns `{items, nextBefore}`                                               |

Ticket, display and report endpoints are added with their milestones.

## Realtime (Socket.IO)

- Path: `/socket.io`. It authenticates with the same session cookie and falls back to long-polling automatically.
- Rooms: `org:<id>`, `user:<id>`. Branch, agent and display rooms, and the event catalogue, come with milestones 4–5.
