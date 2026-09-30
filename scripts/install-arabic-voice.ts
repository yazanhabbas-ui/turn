/**
 * Adds the Arabic voices that ship with the project (public/audio/ar) to the first organization. Optionally makes
 * one the active voice. The same can be done in Admin → Screens → Voice. Safe to run again.
 *
 *   npm run voice:install-arabic                    # add all bundled voices
 *   npm run voice:install-arabic -- ar-sa-hamed     # ...and use this one (see public/audio/ar/catalog.json)
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "@/db/client";
import { bundledCatalog, installBundledVoices, packLabel } from "@/server/display/bundled-voices";
import { defaultSetting } from "@/server/settings/registry";
import { getSetting, putSetting } from "@/server/settings/service";

async function main() {
  const [org] = await db().select().from(schema.organizations).limit(1);
  if (!org) throw new Error("no organization; run npm run db:seed first");
  const { added, total } = await installBundledVoices(org.id);
  console.log(`Bundled Arabic voices: ${total} available, ${added} added.`);
  const choice = process.argv[2];
  if (!choice) return;
  const voice = bundledCatalog().find((v) => v.id === choice);
  if (!voice)
    throw new Error(
      `unknown voice "${choice}"; choose one of: ${bundledCatalog()
        .map((v) => v.id)
        .join(", ")}`,
    );
  const t = schema.ttsAudioPacks;
  await db()
    .update(t)
    .set({ isActive: false })
    .where(and(eq(t.organizationId, org.id), eq(t.locale, "ar")));
  await db()
    .update(t)
    .set({ isActive: true })
    .where(and(eq(t.organizationId, org.id), eq(t.locale, "ar"), eq(t.name, packLabel(voice))));
  await putSetting(org.id, "voice", { ...defaultSetting("voice"), ...(await getSetting(org.id, "voice")), provider: "pack" });
  console.log(`Using ${packLabel(voice)}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
