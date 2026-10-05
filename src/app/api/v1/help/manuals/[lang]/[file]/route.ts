import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { AppError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { manualPath } from "@/server/help/manuals";

/** A user manual as a PDF. Any signed-in user may read it; `?download=1` saves it instead of showing it in the browser. */
export const GET = route({ rateLimit: { name: "help-manuals", limit: 60, windowMs: 60_000, by: "user" } }, async ({ params, query }) => {
  const file = manualPath(params.lang, params.file);
  if (!file) throw new AppError("not_found");
  const body = await fs.readFile(file);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${query.get("download") ? "attachment" : "inline"}; filename="${params.file}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=300",
    },
  });
});
