import { randomBytes } from "node:crypto";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { toWesternDigits } from "@/domain/i18n/digits";
import { decrypt, encrypt } from "../crypto";

const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

export function totpUri(issuer: string, accountName: string, secret: Uint8Array): string {
  return createTOTPKeyURI(issuer, accountName, secret, PERIOD_SECONDS, DIGITS);
}

/** Accepts the previous/next 30-second step to tolerate clock drift on phones. */
export function verifyTotp(secret: Uint8Array, code: string): boolean {
  const normalized = toWesternDigits(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  return verifyTOTPWithGracePeriod(secret, PERIOD_SECONDS, DIGITS, normalized, PERIOD_SECONDS);
}

export const encryptTotpSecret = (secret: Uint8Array) => encrypt(secret);
export const decryptTotpSecret = (enc: string) => new Uint8Array(decrypt(enc));
