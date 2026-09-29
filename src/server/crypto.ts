import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding";
import { env } from "./env";

/** 160 bits of entropy, URL-safe. Used for session, invite, device and public-status tokens. */
export function randomToken(bytes = 20): string {
  return encodeBase32LowerCaseNoPadding(randomBytes(bytes));
}

export function sha256Hex(value: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(value)));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Short human-typable code without ambiguous characters (0/O, 1/I/L). */
export function randomCode(length = 6): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function encryptionKey(): Buffer {
  const key = Buffer.from(env().APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: Uint8Array | string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(typeof plain === "string" ? Buffer.from(plain) : plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decrypt(payload: string): Buffer {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

/** Keyed hash of a normalized phone number. */
export function hashPhone(normalizedPhone: string): string {
  return createHmac("sha256", env().PHONE_HASH_KEY).update(normalizedPhone).digest("hex");
}
