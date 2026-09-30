import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db/client";
import { brandAssets } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { getSetting } from "../settings/service";
import { auditMeta, orgOf, requireOrgWide, type Actor } from "./actor";
import { updateSetting } from "./settings-admin";

/** Largest accepted upload; the stored logo is far smaller. */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
/** Decoded size guard: large artwork is fine (the original was 15499x5947), a decompression bomb is not. */
export const LOGO_MAX_PIXELS = 100_000_000;
export const LOGO_MAX_WIDTH = 1200;
export const LOGO_MAX_HEIGHT = 480;
/** No svg: it can carry scripts. */
const ALLOWED = new Set(["png", "jpeg", "webp", "gif"]);
const KIND = "logo";

/** Where the uploaded logo is served (public, so the login page, tickets and screens can show it). */
export const logoPublicUrl = (version: number) => `/api/v1/public/branding/logo?v=${version}`;

/**
 * Validates the real image type, keeps transparency, fits the image inside 1200x480 (never enlarging) and stores it
 * as png without metadata. Animated images and anything sharp cannot decode are refused.
 */
export async function processLogo(input: Buffer): Promise<Buffer> {
  if (!input.length) throw new AppError("validation", { field: "file", reason: "empty" });
  if (input.length > LOGO_MAX_BYTES)
    throw new AppError("validation", { field: "file", reason: "too_large", max: LOGO_MAX_BYTES });
  try {
    const image = sharp(input, { limitInputPixels: LOGO_MAX_PIXELS, failOn: "none" });
    const meta = await image.metadata();
    if (!meta.format || !ALLOWED.has(meta.format))
      throw new AppError("validation", { field: "file", reason: "unsupported_type" });
    if ((meta.pages ?? 1) > 1) throw new AppError("validation", { field: "file", reason: "animated" });
    return await image
      .rotate()
      .resize(LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("validation", { field: "file", reason: "unsupported_type" });
  }
}

async function setLogoUrl(actor: Actor, logoUrl: string | null) {
  const branding = await getSetting(orgOf(actor), "branding");
  await updateSetting(actor, "branding", { ...branding, logoUrl });
}

/** Replaces the organization's logo and points `branding.logoUrl` at it. Needs `settings.manage` organization-wide. */
export async function setLogo(actor: Actor, input: Buffer): Promise<{ version: number; logoUrl: string }> {
  requireOrgWide(actor, "settings.manage");
  const data = await processLogo(input);
  const organizationId = orgOf(actor);
  const [row] = await db()
    .insert(brandAssets)
    .values({ organizationId, kind: KIND, contentType: "image/png", data })
    .onConflictDoUpdate({
      target: [brandAssets.organizationId, brandAssets.kind],
      set: { data, contentType: "image/png", version: sql`${brandAssets.version} + 1`, updatedAt: new Date() },
    })
    .returning({ version: brandAssets.version });
  const logoUrl = logoPublicUrl(row.version);
  await setLogoUrl(actor, logoUrl);
  await audit({
    ...auditMeta(actor),
    action: "branding.logo_set",
    entityType: "brand_asset",
    entityId: KIND,
    after: { version: row.version, bytes: data.length },
  });
  return { version: row.version, logoUrl };
}

/** Deletes the uploaded logo (if any) and clears `branding.logoUrl`. */
export async function removeLogo(actor: Actor): Promise<void> {
  requireOrgWide(actor, "settings.manage");
  const removed = await db()
    .delete(brandAssets)
    .where(and(eq(brandAssets.organizationId, orgOf(actor)), eq(brandAssets.kind, KIND)))
    .returning({ version: brandAssets.version });
  await setLogoUrl(actor, null);
  if (removed.length)
    await audit({
      ...auditMeta(actor),
      action: "branding.logo_removed",
      entityType: "brand_asset",
      entityId: KIND,
      before: { version: removed[0].version },
    });
}

/** The stored logo of an organization with its ETag; null when none was uploaded. */
export async function loadLogo(organizationId: string) {
  const [row] = await db()
    .select({ data: brandAssets.data, contentType: brandAssets.contentType, version: brandAssets.version })
    .from(brandAssets)
    .where(and(eq(brandAssets.organizationId, organizationId), eq(brandAssets.kind, KIND)));
  if (!row) return null;
  const etag = `"${createHash("sha1").update(row.data).digest("hex").slice(0, 20)}"`;
  return { ...row, etag };
}
