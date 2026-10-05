const URL_MAX = 500;

/** `https://` addresses only: no javascript:, data:, http:, or addresses with a user name or password. */
export function isSafeHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > URL_MAX || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export const URL_MAX_LENGTH = URL_MAX;
