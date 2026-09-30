import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

const LOCALE_ALT = routing.locales.join("|");
/** Areas that require a signed-in user. Full session validation happens server-side; this only avoids a flash. */
const PROTECTED = new RegExp(`^/(?:(?:${LOCALE_ALT})/)?(admin|reception|agent|account|profile|reports|wallboard)(?:/|$)`);
const LOCALE_PREFIX = new RegExp(`^/(${LOCALE_ALT})(?=/|$)`);

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.test(pathname) && !req.cookies.get("dor_session")) {
    const localeMatch = pathname.match(LOCALE_PREFIX);
    const prefix = localeMatch && localeMatch[1] !== routing.defaultLocale ? `/${localeMatch[1]}` : "";
    const url = req.nextUrl.clone();
    url.pathname = `${prefix}/login`;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return intl(req);
}

export const config = {
  // Everything except API routes, Next internals, static files and the socket endpoint.
  matcher: ["/((?!api|_next|_vercel|socket\\.io|audio|icons|.*\\..*).*)"],
};
