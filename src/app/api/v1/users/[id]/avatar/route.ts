import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { loadAvatar, removeAvatar } from "@/server/profile/avatar";

/** The picture of a user. Cached by the browser; the `?v=` from `avatarVersion` busts the cache when it changes. */
export const GET = route({}, async ({ req, actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw new AppError("not_found");
  const img = await loadAvatar(actor, id.data);
  if (!img) throw new AppError("not_found");
  const headers = {
    ETag: img.etag,
    "Cache-Control": req.nextUrl.searchParams.has("v") ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (req.headers.get("if-none-match") === img.etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(img.data), {
    headers: { ...headers, "Content-Type": img.contentType, "X-Content-Type-Options": "nosniff" },
  });
});

/** Removes a picture (one's own, or another person's with users.manage). */
export const DELETE = route({}, async ({ actor, params }) => {
  await removeAvatar(actor, params.id);
  return { ok: true };
});
