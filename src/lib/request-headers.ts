import type { NextRequest, NextResponse } from "next/server";

/**
 * Adds a header to the request that the page will see, on a response built elsewhere (here: by next-intl). This is
 * what `NextResponse.next({ request: { headers } })` does underneath: Next.js reads `x-middleware-override-headers`
 * (the full list of request headers to use) and one `x-middleware-request-<name>` per header.
 */
export function withRequestHeader(res: NextResponse, req: NextRequest, name: string, value: string): NextResponse {
  const lower = name.toLowerCase();
  const existing = res.headers.get("x-middleware-override-headers");
  const names = new Set(existing ? existing.split(",") : [...req.headers.keys()]);
  if (!existing) for (const [k, v] of req.headers) res.headers.set(`x-middleware-request-${k}`, v);
  names.add(lower);
  res.headers.set("x-middleware-override-headers", [...names].join(","));
  res.headers.set(`x-middleware-request-${lower}`, value);
  return res;
}
