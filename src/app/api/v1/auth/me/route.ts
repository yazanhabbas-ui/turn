import { route } from "@/server/http/route";

export const GET = route({ auth: "pending2fa" }, async ({ auth }) => ({
  user: { ...auth.user, avatarVersion: auth.user.avatarVersion ?? null, hasAvatar: auth.user.avatarVersion != null },
  twoFactorVerified: auth.twoFactorVerified,
  grants: auth.grants,
}));
