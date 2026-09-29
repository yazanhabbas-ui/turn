import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  HOSTNAME: z.string().default("0.0.0.0"),
  /** Public base URL used in invite links, QR codes and emails, e.g. http://queue.local:3000 */
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://dor:dor@localhost:5432/dor"),
  DATABASE_POOL_MAX: z.coerce.number().int().default(20),
  /** Optional. When unset, realtime and rate limiting run in-memory (single node). */
  REDIS_URL: z.string().optional(),
  /** 32 bytes, base64. Encrypts TOTP secrets at rest. */
  APP_ENCRYPTION_KEY: z.string().min(40),
  /** HMAC key for visitor phone hashes (sticky routing without exposing numbers). */
  PHONE_HASH_KEY: z.string().min(16),
  SESSION_TTL_HOURS: z.coerce.number().int().default(12),
  /** Set when running behind a reverse proxy so X-Forwarded-For is trusted for client IPs. */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Cookies are marked Secure when APP_URL is https. Override for LAN setups behind TLS termination. */
  COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Dor Queue <no-reply@localhost>"),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function cookieSecure(): boolean {
  const e = env();
  if (e.COOKIE_SECURE === "auto") return e.APP_URL.startsWith("https://");
  return e.COOKIE_SECURE === "true";
}
