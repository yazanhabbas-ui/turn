import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { schedules, users, visitReasons } from "@/db/schema";
import { seedOrganization } from "@/db/seed/demo";
import type { Actor } from "@/server/admin/actor";
import { loadGrants } from "@/server/auth/session";
import { truncateAll } from "./helpers";

/** Fresh demo organization (the same data as `npm run db:seed`). */
export async function resetDemo(): Promise<string> {
  await truncateAll();
  const { organizationId } = await db().transaction((tx) => seedOrganization(tx, "demo"));
  return organizationId;
}

/** Builds an admin-service actor for a seeded user, as if they were signed in. */
export async function actorFor(email: string): Promise<Actor> {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`no user ${email}`);
  return {
    ip: "127.0.0.1",
    userAgent: "vitest",
    auth: {
      sessionId: "test",
      twoFactorVerified: true,
      expiresAt: new Date(Date.now() + 3600_000),
      grants: await loadGrants(u.id),
      user: {
        id: u.id,
        organizationId: u.organizationId,
        email: u.email,
        displayName: u.displayName,
        locale: u.locale,
        totpEnabled: !!u.totpEnabledAt,
      },
    },
  };
}

/** Demo reasons are always open; tests about opening hours attach the demo timetable (Sun–Thu 08:00–16:00). */
export async function attachOfficeHours() {
  const [schedule] = await db().select({ id: schedules.id }).from(schedules).limit(1);
  await db().update(visitReasons).set({ scheduleId: schedule.id });
}
