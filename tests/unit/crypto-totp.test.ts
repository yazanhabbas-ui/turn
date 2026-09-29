import { generateTOTP } from "@oslojs/otp";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from "@/server/auth/totp";
import { randomCode, randomToken, sha256Hex } from "@/server/crypto";
import { toEasternDigits } from "@/domain/i18n/digits";

describe("crypto helpers", () => {
  it("generates unique tokens and codes", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    expect(randomCode(6)).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Correct-Horse-9")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("totp", () => {
  it("encrypts secrets at rest and verifies codes, including Eastern digits", () => {
    const secret = generateTotpSecret();
    const restored = decryptTotpSecret(encryptTotpSecret(secret));
    expect(Buffer.from(restored).equals(Buffer.from(secret))).toBe(true);
    const code = generateTOTP(secret, 30, 6);
    expect(verifyTotp(restored, code)).toBe(true);
    expect(verifyTotp(restored, toEasternDigits(code))).toBe(true);
    if (code !== "000000") expect(verifyTotp(restored, "000000")).toBe(false);
    expect(verifyTotp(restored, "12ab56")).toBe(false);
  });
});
