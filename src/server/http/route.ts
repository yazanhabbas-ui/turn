import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { can, type Permission } from "@/domain/rbac/permissions";
import type { Actor } from "../admin/actor";
import { SESSION_COOKIE, validateSessionToken, type AuthContext } from "../auth/session";
import { cookieSecure, env } from "../env";
import { logger } from "../logger";
import { rateLimit } from "../rate-limit";
import { AppError } from "./errors";

type AuthMode = "session" | "public" | "pending2fa";

type RouteOptions<B> = {
  /** `session` (default): signed-in and 2FA-complete. `pending2fa`: signed-in, TOTP may be outstanding. */
  auth?: AuthMode;
  permission?: Permission;
  body?: ZodType<B>;
  rateLimit?: { name: string; limit: number; windowMs: number; by?: "ip" | "user" };
};

type Ctx<A extends AuthMode, B> = {
  req: NextRequest;
  body: B;
  ip: string;
  params: Record<string, string>;
  auth: A extends "public" ? AuthContext | null : AuthContext;
  /** auth + client info, for services that check permissions and write the audit trail. */
  actor: A extends "public" ? Actor | null : Actor;
  /** Parsed query string. */
  query: URLSearchParams;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIp(req: NextRequest): string {
  if (env().TRUST_PROXY) {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
  }
  // Set by server.ts from the socket address (incoming copies of this header are discarded there).
  return req.headers.get("x-dor-client-ip") ?? "unknown";
}

/** CSRF defence: cookie-authenticated mutations must come from our own origin. */
function checkOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new AppError("bad_origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("bad_origin");
  }
  const allowed = new Set([req.headers.get("host"), new URL(env().APP_URL).host]);
  if (!allowed.has(originHost)) throw new AppError("bad_origin");
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          details: { issues: err.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })) },
        },
      },
      { status: 400 },
    );
  }
  logger.error({ err }, "unhandled route error");
  return NextResponse.json({ error: { code: "server_error" } }, { status: 500 });
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", maxAge: 0 });
}

/**
 * Wraps a Next.js route handler with authentication, permission checks, CSRF origin checks,
 * body validation, rate limiting and consistent JSON errors.
 */
export function route<B = undefined, A extends AuthMode = "session">(
  opts: RouteOptions<B> & { auth?: A },
  handler: (ctx: Ctx<A, B>) => Promise<NextResponse | object | null>,
) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => {
    const started = Date.now();
    try {
      checkOrigin(req);
      const ip = clientIp(req);
      const mode: AuthMode = opts.auth ?? "session";

      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const auth = token ? await validateSessionToken(token) : null;
      if (mode !== "public") {
        if (!auth) throw new AppError("unauthorized");
        if (mode === "session" && !auth.twoFactorVerified) throw new AppError("totp_required");
        if (opts.permission && !can(auth.grants, opts.permission)) throw new AppError("forbidden");
      }

      if (opts.rateLimit) {
        const who = opts.rateLimit.by === "user" && auth ? auth.user.id : ip;
        const r = await rateLimit(`${opts.rateLimit.name}:${who}`, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!r.ok) {
          const res = NextResponse.json({ error: { code: "rate_limited" } }, { status: 429 });
          res.headers.set("Retry-After", String(r.retryAfterSeconds));
          return res;
        }
      }

      let body = undefined as B;
      if (opts.body) {
        const json = await req.json().catch(() => {
          throw new AppError("validation", { reason: "invalid_json" });
        });
        body = opts.body.parse(json);
      }

      const result = await handler({
        req,
        body,
        ip,
        params: (await segment?.params) ?? {},
        auth: auth as Ctx<A, B>["auth"],
        actor: (auth ? { auth, ip, userAgent: req.headers.get("user-agent") } : null) as Ctx<A, B>["actor"],
        query: req.nextUrl.searchParams,
      });
      const res = result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
      // Responses are never cached unless the handler asks for it (only the avatar image does).
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      return errorResponse(err);
    } finally {
      logger.debug({ method: req.method, path: req.nextUrl.pathname, ms: Date.now() - started }, "api");
    }
  };
}
