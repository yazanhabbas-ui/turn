import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { route } from "@/server/http/route";
import { LOCALE_CODES } from "@/i18n/locales";

/** Saves the user's interface language so it follows them across devices. */
export const POST = route(
  { body: z.object({ locale: z.enum(LOCALE_CODES as [string, ...string[]]) }) },
  async ({ auth, body }) => {
    await db().update(users).set({ locale: body.locale }).where(eq(users.id, auth.user.id));
    return { ok: true };
  },
);
