import { AVATAR_MAX_BYTES, removeAvatar, setOwnAvatar } from "@/server/profile/avatar";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";

/** Upload the signed-in user's picture: multipart form with a `file` field (png, jpeg or webp, up to 2 MB). */
export const POST = route(
  { rateLimit: { name: "avatar", limit: 20, windowMs: 3600_000, by: "user" } },
  async ({ req, actor }) => {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > AVATAR_MAX_BYTES + 64 * 1024)
      throw new AppError("validation", { field: "file", reason: "too_large", max: AVATAR_MAX_BYTES });
    const form = await req.formData().catch(() => {
      throw new AppError("validation", { field: "file", reason: "invalid_form" });
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("validation", { field: "file", reason: "missing" });
    if (file.size > AVATAR_MAX_BYTES)
      throw new AppError("validation", { field: "file", reason: "too_large", max: AVATAR_MAX_BYTES });
    return setOwnAvatar(actor, Buffer.from(await file.arrayBuffer()));
  },
);

export const DELETE = route({}, async ({ actor }) => {
  await removeAvatar(actor, actor.auth.user.id);
  return { ok: true };
});
