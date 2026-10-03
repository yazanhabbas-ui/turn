import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { buildPageCsp, newNonce } from "./lib/csp";
import { withRequestHeader } from "./lib/request-headers";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

const LOCALE_ALT = routing.locales.join("|");
/** Areas that require a signed-in user. Full session validation happens server-side; this only avoids a flash. */
const PROTECTED = new RegExp(`^/(?:(?:${LOCALE_ALT})/)?(admin|reception|agent|account|profile|reports|wallboard)(?:/|$)`);
const LOCALE_PREFIX = new RegExp(`^/(${LOCALE_ALT})(?=/|$)`);
/** Either name of the session cookie (the `__Host-` one is used over https, see sessionCookieName). */
const SESSION_COOKIES = ["dor_session", "__Host-dor_session"];

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.test(pathname) && !SESSION_COOKIES.some((c) => req.cookies.get(c))) {
    const localeMatch = pathname.match(LOCALE_PREFIX);
    const prefix = localeMatch && localeMatch[1] !== routing.defaultLocale ? `/${localeMatch[1]}` : "";
    const url = req.nextUrl.clone();
    url.pathname = `${prefix}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Per-response nonce: the policy goes on the request too, so Next.js stamps the nonce on the scripts it renders.
  const host = req.headers.get("host");
  const https = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  const nonce = newNonce();
  const csp = buildPageCsp({ nonce, host, dev: process.env.NODE_ENV === "development", https });
  // x-nonce lets our own inline script (the theme initialiser) carry the same nonce.
  const res = withRequestHeader(withRequestHeader(intl(req), req, "content-security-policy", csp), req, "x-nonce", nonce);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Everything except API routes, Next internals, static files and the socket endpoint.
  matcher: ["/((?!api|_next|socket\\.io|audio|icons|.*\\..*).*)"],
};
