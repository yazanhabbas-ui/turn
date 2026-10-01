import { logger } from "../logger";

/**
 * Keys and passwords that ship in this repository (docker-compose defaults, the Docker build placeholder, tests,
 * the demo seed). Anyone can read them, so a server that protects real data must not run with them.
 */
const KNOWN_ENCRYPTION_KEYS = new Set([
  "ZG9yLWRldi1vbmx5LWtleS1jaGFuZ2UtbWUtcGxlYXM=", // docker-compose.yml default
  "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=", // Dockerfile build placeholder and tests (32 x 0x07)
]);
const KNOWN_PHONE_KEYS = new Set(["dor-dev-only-phone-hash-key", "build-time-placeholder-key", "test-phone-hash-key-0123456789"]);
const DEMO_PASSWORD = "Dor@Demo2026";

export type StartupFinding = { level: "error" | "warn"; code: string; message: string };

type Config = {
  NODE_ENV: string;
  APP_URL: string;
  APP_ENCRYPTION_KEY: string;
  PHONE_HASH_KEY: string;
  TRUST_PROXY: boolean;
  DATABASE_URL?: string;
  COOKIE_SECURE?: string;
};

/**
 * Checks the production configuration. `error` findings stop the server from starting; `warn` findings are logged
 * loudly. The server refuses well-known keys when it is reachable over https or when the demo data is switched off
 * (both mean a real installation); a plain-http LAN demo only gets the warning, so `docker compose up` still works.
 */
export function securityFindings(cfg: Config, processEnv: Record<string, string | undefined> = process.env): StartupFinding[] {
  if (cfg.NODE_ENV !== "production") return [];
  const out: StartupFinding[] = [];
  const https = cfg.APP_URL.startsWith("https://");
  const demo = processEnv.SEED_DEMO === "true";
  const real = https || !demo;
  const strict = (code: string, message: string) => out.push({ level: real ? "error" : "warn", code, message });

  if (KNOWN_ENCRYPTION_KEYS.has(cfg.APP_ENCRYPTION_KEY))
    strict(
      "default_encryption_key",
      "APP_ENCRYPTION_KEY is a well-known development key: anyone can decrypt the stored 2FA secrets. Generate one with: openssl rand -base64 32",
    );
  if (KNOWN_PHONE_KEYS.has(cfg.PHONE_HASH_KEY))
    strict(
      "default_phone_hash_key",
      "PHONE_HASH_KEY is a well-known development key: visitor phone hashes and STOP links can be forged. Generate one with: openssl rand -hex 24",
    );
  if (demo && (processEnv.SEED_PASSWORD ?? DEMO_PASSWORD) === DEMO_PASSWORD)
    out.push({
      level: "warn",
      code: "demo_password",
      message:
        "The demo accounts use the published demo password. Set SEED_DEMO=false for a real installation, or change SEED_PASSWORD and the passwords of the demo users.",
    });
  if (!https)
    out.push({
      level: "warn",
      code: "plain_http",
      message:
        "APP_URL is not https: session cookies are not marked Secure and traffic can be read on the network. Put the app behind a TLS-terminating proxy and set APP_URL to the https address.",
    });
  if (https && !cfg.TRUST_PROXY)
    out.push({
      level: "warn",
      code: "proxy_not_trusted",
      message:
        "APP_URL is https but TRUST_PROXY is false: every client shares the proxy's address, so per-address rate limits and audit IPs are wrong. Set TRUST_PROXY=true when the proxy sets X-Forwarded-For.",
    });
  if (https && cfg.COOKIE_SECURE === "false")
    out.push({
      level: "warn",
      code: "cookie_not_secure",
      message:
        "COOKIE_SECURE=false with an https APP_URL: the session cookie would also travel over plain http. Remove the override.",
    });
  if (cfg.DATABASE_URL && /^postgres(ql)?:\/\/[^:@/]+:(dor|postgres|password|changeme)@/i.test(cfg.DATABASE_URL))
    out.push({
      level: "warn",
      code: "default_database_password",
      message:
        "The database password is a well-known default. Set POSTGRES_PASSWORD (and DATABASE_URL) to a long random value and keep the database port off the network.",
    });
  return out;
}

/** Logs the findings and throws when any is an `error`. Called once from server.ts before anything listens. */
export function assertSecureConfiguration(cfg: Config, processEnv: Record<string, string | undefined> = process.env): void {
  const findings = securityFindings(cfg, processEnv);
  for (const f of findings) {
    if (f.level === "warn") logger.warn({ code: f.code }, `SECURITY: ${f.message}`);
    else logger.error({ code: f.code }, `SECURITY: ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length)
    throw new Error(
      `Refusing to start with insecure configuration:\n${errors.map((e) => `  - ${e.message}`).join("\n")}\nSee the SECURITY section of the README.`,
    );
}
