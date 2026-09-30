import { NextResponse } from "next/server";
import { getDefaultOrganizationId } from "@/server/branding";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { loadLogo, parseLogoVariant } from "@/server/admin/logo";

/** The uploaded logo (`?variant=dark` for the dark-background one). Public (login page, tickets, screens); with `?v=<version>` it is cached for a year. */
export const GET = route({ auth: "public" }, async ({ req }) => {
  const orgId = await getDefaultOrganizationId();
  const img = orgId ? await loadLogo(orgId, parseLogoVariant(req.nextUrl.searchParams.get("variant"))) : null;
  if (!img) throw new AppError("not_found");
  const headers = {
    ETag: img.etag,
    "Cache-Control": req.nextUrl.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, no-cache",
  };
  if (req.headers.get("if-none-match") === img.etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(img.data), {
    headers: { ...headers, "Content-Type": img.contentType, "X-Content-Type-Options": "nosniff" },
  });
});
