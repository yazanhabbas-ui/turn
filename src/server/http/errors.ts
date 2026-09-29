export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_credentials"
  | "account_locked"
  | "organization_required"
  | "totp_required"
  | "invalid_code"
  | "weak_password"
  | "wrong_password"
  | "bad_origin"
  | "invalid_transition"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  invalid_credentials: 401,
  account_locked: 423,
  organization_required: 400,
  totp_required: 401,
  invalid_code: 400,
  weak_password: 400,
  wrong_password: 400,
  bad_origin: 403,
  invalid_transition: 409,
  server_error: 500,
};

/** An error that is safe to return to the client as `{ error: { code, details } }`. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    status?: number,
  ) {
    super(code);
    this.status = status ?? STATUS[code];
  }
}
