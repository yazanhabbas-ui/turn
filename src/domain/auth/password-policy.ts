export type PasswordPolicy = {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
};

export type PasswordIssue = "tooShort" | "tooLong" | "upper" | "lower" | "digit" | "symbol" | "common" | "containsEmail";

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "iloveyou",
  "admin123",
  "welcome1",
  "p@ssw0rd",
  "passw0rd",
  "abc12345",
  "00000000",
  "11111111",
]);

/** Returns the list of violated rules (empty = acceptable). Pure; the same rules run in the browser. */
export function checkPassword(password: string, policy: PasswordPolicy, context: { email?: string } = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < policy.minLength) issues.push("tooShort");
  if (password.length > 256) issues.push("tooLong");
  // Unicode-aware: Arabic letters have no case, so an Arabic passphrase satisfies letter rules via length.
  if (policy.requireUpper && !/\p{Lu}/u.test(password) && !/\p{Lo}/u.test(password)) issues.push("upper");
  if (policy.requireLower && !/\p{Ll}/u.test(password) && !/\p{Lo}/u.test(password)) issues.push("lower");
  if (policy.requireDigit && !/\p{Nd}/u.test(password)) issues.push("digit");
  if (policy.requireSymbol && !/[^\p{L}\p{Nd}]/u.test(password)) issues.push("symbol");
  if (COMMON.has(password.toLowerCase())) issues.push("common");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) issues.push("containsEmail");
  return issues;
}
