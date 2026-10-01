import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { API_CSP } from "./src/lib/csp";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Headers for every response. The Content-Security-Policy of pages carries a per-response nonce, so it is set in
 * src/middleware.ts (see src/lib/csp.ts); API responses get a policy that allows nothing. Strict-Transport-Security is
 * added by server.ts, because it depends on the runtime APP_URL (https), not on the build.
 */
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
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
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default withNextIntl(nextConfig);
