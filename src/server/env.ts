import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  /** Bind address. "::" = all interfaces, IPv4 and IPv6 (falls back to IPv4-only automatically). */
  HOSTNAME: z.string().default("::"),
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
  /** WhatsApp Cloud API (Meta). Both token and phone id must be set for the channel to be configured. */
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_API_URL: z.string().url().default("https://graph.facebook.com"),
  /** SMS: `http` = a generic gateway described by the SMS_* variables below, `twilio` = the Twilio preset. */
  SMS_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["http", "twilio"]).optional()),
  SMS_URL: z.string().optional(),
  SMS_METHOD: z.enum(["POST", "PUT", "GET"]).default("POST"),
  /** Full header line, e.g. "Authorization: Bearer abc" or "X-Api-Key: abc". */
  SMS_AUTH_HEADER: z.string().optional(),
  SMS_BODY_FORMAT: z.enum(["json", "form"]).default("json"),
  /** Body with {to} {text} {from} placeholders; values are escaped for the format automatically. */
  SMS_BODY: z.string().optional(),
  SMS_FROM: z.string().optional(),
  /** Dotted path of the message id in the JSON response, e.g. "data.id" (optional). */
  SMS_MESSAGE_ID_PATH: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Seconds before a provider request is abandoned. */
  MESSAGING_TIMEOUT_SECONDS: z.coerce.number().int().min(2).max(60).default(15),
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
