import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    // No third-party origins at runtime (PDPL / on-prem). 'unsafe-inline' for scripts is required by Next.js
    // hydration without nonces; tightened with nonces in the hardening milestone.
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "media-src 'self' data: blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets a production build live next to a running dev server (e.g. NEXT_DIST_DIR=.next-prod).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The local launcher builds with DOR_FAST_BUILD=1: lint and typecheck already run in CI and `npm run typecheck`.
  eslint: { ignoreDuringBuilds: process.env.DOR_FAST_BUILD === "1" },
  typescript: { ignoreBuildErrors: process.env.DOR_FAST_BUILD === "1" },
  serverExternalPackages: ["@node-rs/argon2", "pg-boss", "pino", "pg", "pdfkit", "exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
