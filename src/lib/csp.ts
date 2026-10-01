/**
 * Content-Security-Policy for pages. Scripts run only when they carry the per-response nonce (Next.js puts it on its
 * own scripts when the policy is present on the request), plus whatever those scripts load themselves ('strict-dynamic').
 * Styles allow inline because React and the UI library write style attributes, which a nonce cannot cover; nothing
 * is loaded from another site (the system works on a closed office network and must not call third parties).
 */
export function buildPageCsp(opts: { nonce: string; host?: string | null; dev?: boolean; https?: boolean }): string {
  const { nonce, host, dev = false, https = false } = opts;
  // The realtime socket is same-site. Listing the sockets of this host explicitly keeps "ws:" (any host) out of the policy.
  const sockets = host && /^[A-Za-z0-9.:\-[\]]+$/.test(host) ? [`ws://${host}`, `wss://${host}`] : [];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...sockets].join(" ")}`,
    "media-src 'self' data: blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Policy for API responses and files: they never need to run or load anything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** A fresh random nonce (works in the edge runtime and Node). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
