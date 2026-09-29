/**
 * Registers the bundled Arabic voice pack (public/audio/ar/*.wav + manifest.json) for the first organization and
 * switches the announcement provider to pre-recorded clips. Safe to run again.
 *
 *   npm run voice:install-arabic
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "@/db/client";
import { defaultSetting } from "@/server/settings/registry";
import { getSetting, putSetting } from "@/server/settings/service";

const NAME = "Arabic (Piper ar_JO kareem)";

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/audio/ar/manifest.json"), "utf8")) as Record<
    string,
    string
  >;
  for (const url of Object.values(manifest)) {
    if (!fs.existsSync(path.join(process.cwd(), "public", url))) throw new Error(`missing clip ${url}`);
  }
  const [org] = await db().select().from(schema.organizations).limit(1);
  if (!org) throw new Error("no organization; run npm run db:seed first");
  const t = schema.ttsAudioPacks;
  const [existing] = await db()
    .select()
    .from(t)
    .where(and(eq(t.organizationId, org.id), eq(t.locale, "ar"), eq(t.name, NAME)));
  if (existing) await db().update(t).set({ manifest, isActive: true, updatedAt: new Date() }).where(eq(t.id, existing.id));
  else await db().insert(t).values({ organizationId: org.id, locale: "ar", name: NAME, manifest, isActive: true });
  const voice = { ...defaultSetting("voice"), ...(await getSetting(org.id, "voice")), provider: "pack" as const };
  await putSetting(org.id, "voice", voice);
  console.log(`Installed ${Object.keys(manifest).length} Arabic clips and switched the voice provider to pre-recorded clips.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
