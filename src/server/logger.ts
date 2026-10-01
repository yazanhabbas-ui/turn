import pino from "pino";

/** Structured JSON logger. PII (phones, emails, names) must never be logged; use ids. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "dor" },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "phone",
      "*.phone",
      "email",
      "*.email",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
      "req.headers.cookie",
      "req.headers.authorization",
      "*.headers.cookie",
      "*.headers.authorization",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
