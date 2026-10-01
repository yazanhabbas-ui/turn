import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { can, type Permission } from "@/domain/rbac/permissions";
import { redirect } from "@/i18n/navigation";
import { sessionCookieName, validateSessionToken, type AuthContext } from "./session";

/** Session of the current request (memoized per request). */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  try {
    return await validateSessionToken(token);
  } catch {
    return null;
  }
});

/**
 * For server components: ensures a fully signed-in user. Redirects to login / 2FA when needed and returns
 * `{ auth, allowed }` so the page can render a friendly "access denied" instead of a blank error.
 */
export async function requireAuth(locale: string, permission?: Permission): Promise<{ auth: AuthContext; allowed: boolean }> {
  const auth = await getAuth();
  if (!auth) return redirect({ href: "/login", locale });
  if (!auth.twoFactorVerified) return redirect({ href: "/login/two-factor", locale });
  return { auth, allowed: permission ? can(auth.grants, permission) : true };
}
