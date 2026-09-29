import { route } from "@/server/http/route";

export const GET = route({ auth: "pending2fa" }, async ({ auth }) => ({
  user: auth.user,
  twoFactorVerified: auth.twoFactorVerified,
  grants: auth.grants,
}));
