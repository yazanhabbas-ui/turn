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

Endpoints for users, roles, invites, branches, reasons, tickets, displays and reports are added with each milestone and documented here.

## Realtime (Socket.IO)

- Path: `/socket.io`. It authenticates with the same session cookie and falls back to long-polling automatically.
- Rooms: `org:<id>`, `user:<id>`. Branch, agent and display rooms, and the event catalogue, come with milestones 4–5.
