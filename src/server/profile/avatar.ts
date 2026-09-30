import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db/client";
import { userAvatars, users } from "@/db/schema";
import type { Actor } from "../admin/actor";
import { auditMeta, orgOf } from "../admin/actor";
import { assertManages } from "../admin/users";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { can } from "@/domain/rbac/permissions";

/** Largest accepted upload, and the size the stored picture is reduced to. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;
const ALLOWED = new Set(["png", "jpeg", "webp"]);

/**
 * Validates the real image type (not the file name or the declared content type), reduces it to a square
 * 256x256 webp and drops all metadata (EXIF, GPS, ICC). Anything sharp cannot decode is refused.
 */
export async function processAvatar(input: Buffer): Promise<Buffer> {
  if (!input.length) throw new AppError("validation", { field: "file", reason: "empty" });
  if (input.length > AVATAR_MAX_BYTES)
    throw new AppError("validation", { field: "file", reason: "too_large", max: AVATAR_MAX_BYTES });
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (!meta.format || !ALLOWED.has(meta.format))
      throw new AppError("validation", { field: "file", reason: "unsupported_type" });
    // rotate() applies the EXIF orientation before the metadata is dropped; sharp writes no metadata unless asked.
    return await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("validation", { field: "file", reason: "unsupported_type" });
  }
}

/** Sets the signed-in user's own picture (every user may; no permission needed). Returns the new version. */
export async function setOwnAvatar(actor: Actor, input: Buffer): Promise<{ avatarVersion: number }> {
  const data = await processAvatar(input);
  const userId = actor.auth.user.id;
  return db().transaction(async (tx) => {
    const [u] = await tx.select({ v: users.avatarVersion }).from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new AppError("not_found");
    const avatarVersion = (u.v ?? 0) + 1;
    await tx
      .insert(userAvatars)
      .values({ userId, contentType: "image/webp", data })
      .onConflictDoUpdate({ target: userAvatars.userId, set: { data, contentType: "image/webp", updatedAt: new Date() } });
    await tx.update(users).set({ avatarVersion }).where(eq(users.id, userId));
    await audit(
      { ...auditMeta(actor), action: "user.avatar_set", entityType: "user", entityId: userId, after: { avatarVersion } },
      tx,
    );
    return { avatarVersion };
  });
}

/** Removes a picture: one's own, or anyone's within the scope of `users.manage`. */
export async function removeAvatar(actor: Actor, userId: string): Promise<void> {
  const own = userId === actor.auth.user.id;
  if (!own && !can(actor.auth.grants, "users.manage")) throw new AppError("forbidden", { permission: "users.manage" });
  await db().transaction(async (tx) => {
    const [u] = await tx
      .select({ id: users.id, v: users.avatarVersion })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgOf(actor)), isNull(users.archivedAt)));
    if (!u) throw new AppError("not_found");
    if (!own) await assertManages(actor, userId, tx);
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(users).set({ avatarVersion: null }).where(eq(users.id, userId));
    if (u.v !== null) {
      await audit(
        {
          ...auditMeta(actor),
          action: "user.avatar_removed",
          entityType: "user",
          entityId: userId,
          before: { avatarVersion: u.v },
        },
        tx,
      );
    }
  });
}

/** The stored picture of a user of the same organization, with its ETag; null when there is none. */
export async function loadAvatar(actor: Actor, userId: string) {
  const [row] = await db()
    .select({ data: userAvatars.data, contentType: userAvatars.contentType, v: users.avatarVersion })
    .from(userAvatars)
    .innerJoin(users, eq(users.id, userAvatars.userId))
    .where(and(eq(userAvatars.userId, userId), eq(users.organizationId, orgOf(actor))));
  if (!row) return null;
  const etag = `"${createHash("sha1").update(row.data).digest("hex").slice(0, 20)}"`;
  return { data: row.data, contentType: row.contentType, etag, version: row.v };
}
