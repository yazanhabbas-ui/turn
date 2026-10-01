import { AppError } from "@/server/http/errors";
import { readUpload, route } from "@/server/http/route";
import { LOGO_MAX_BYTES, parseLogoVariant, removeLogo, setLogo } from "@/server/admin/logo";

/**
 * Upload the organization's logo: multipart form with a `file` field (png, jpeg, webp or a still gif, up to 5 MB) and an
 * optional `variant` field: "light" (default; for light backgrounds) or "dark" (for dark and brand-coloured backgrounds).
 */
export const POST = route(
  { permission: "settings.manage", rateLimit: { name: "logo", limit: 20, windowMs: 3600_000, by: "user" } },
  async ({ req, actor }) => {
    const form = await readUpload(req, LOGO_MAX_BYTES);
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("validation", { field: "file", reason: "missing" });
    if (file.size > LOGO_MAX_BYTES) throw new AppError("validation", { field: "file", reason: "too_large", max: LOGO_MAX_BYTES });
    return setLogo(actor, Buffer.from(await file.arrayBuffer()), parseLogoVariant(form.get("variant")));
  },
);

/** Remove a logo; `?variant=dark` removes the dark-background one. */
export const DELETE = route({ permission: "settings.manage" }, async ({ req, actor }) => {
  await removeLogo(actor, parseLogoVariant(req.nextUrl.searchParams.get("variant")));
  return { ok: true };
});
