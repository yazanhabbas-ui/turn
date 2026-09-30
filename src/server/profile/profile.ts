import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProfiles, branches, cities, roles, userRoles, users } from "@/db/schema";
import type { Actor } from "../admin/actor";
import { AppError } from "../http/errors";

export type MyProfile = {
  id: string;
  email: string;
  displayName: Record<string, string>;
  phone: string | null;
  locale: string | null;
  avatarVersion: number | null;
  createdAt: string;
  lastLoginAt: string | null;
  isAgent: boolean;
  /** Roles with where they apply: the whole organization, a city or a branch. */
  roles: {
    roleName: Record<string, string>;
    scope: "organization" | "city" | "branch";
    scopeName: Record<string, string> | null;
  }[];
  /** Branch the user serves at, when they are an agent. */
  agentBranch: Record<string, string> | null;
};

/** The signed-in user's own profile card. */
export async function myProfile(actor: Actor): Promise<MyProfile> {
  const [u] = await db().select().from(users).where(eq(users.id, actor.auth.user.id));
  if (!u) throw new AppError("not_found");
  const [grants, [agent]] = await Promise.all([
    db()
      .select({
        roleName: roles.name,
        branchName: branches.name,
        cityName: cities.name,
        branchId: userRoles.branchId,
        cityId: userRoles.cityId,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(branches, eq(branches.id, userRoles.branchId))
      .leftJoin(cities, eq(cities.id, userRoles.cityId))
      .where(eq(userRoles.userId, u.id)),
    db()
      .select({ branchName: branches.name })
      .from(agentProfiles)
      .innerJoin(branches, eq(branches.id, agentProfiles.branchId))
      .where(eq(agentProfiles.userId, u.id)),
  ]);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    phone: u.phone,
    locale: u.locale,
    avatarVersion: u.avatarVersion,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    isAgent: !!agent,
    roles: grants.map((g) => ({
      roleName: g.roleName,
      scope: g.branchId ? "branch" : g.cityId ? "city" : "organization",
      scopeName: g.branchId ? g.branchName : g.cityId ? g.cityName : null,
    })),
    agentBranch: agent?.branchName ?? null,
  };
}
