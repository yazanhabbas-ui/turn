import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ttsAudioPacks } from "@/db/schema";

type CatalogEntry = { id: string; name: { ar: string; en: string }; gender: string; engine: string };

const ROOT = () => path.join(process.cwd(), "public", "audio", "ar");

/** Arabic voices that ship with the project (public/audio/ar/<id>/ with a manifest.json and clips). */
export function bundledCatalog(): CatalogEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT(), "catalog.json"), "utf8")) as CatalogEntry[];
    return list.filter((v) => fs.existsSync(path.join(ROOT(), v.id, "manifest.json")));
  } catch {
    return [];
  }
}

export const packLabel = (v: CatalogEntry) => `${v.name.en} · ${v.name.ar}`;

/**
 * Registers every bundled voice as an audio pack of the organization (idempotent). New voices are added inactive;
 * existing ones get their clip list refreshed. Returns how many were added.
 */
export async function installBundledVoices(organizationId: string): Promise<{ added: number; total: number }> {
  const t = ttsAudioPacks;
  let added = 0;
  const catalog = bundledCatalog();
  for (const v of catalog) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT(), v.id, "manifest.json"), "utf8")) as Record<string, string>;
    const name = packLabel(v);
    const [existing] = await db()
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.organizationId, organizationId), eq(t.locale, "ar"), eq(t.name, name)));
    if (existing) await db().update(t).set({ manifest, updatedAt: new Date() }).where(eq(t.id, existing.id));
    else {
      await db().insert(t).values({ organizationId, locale: "ar", name, manifest, isActive: false });
      added++;
    }
  }
  return { added, total: catalog.length };
}
