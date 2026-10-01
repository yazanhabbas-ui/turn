import { NextResponse } from "next/server";
import { z } from "zod";
import { auditMeta } from "@/server/admin/actor";
import { audit } from "@/server/audit";
import { route } from "@/server/http/route";
import { buildMyReportExport } from "@/server/profile/report-export";
import { reportQuery } from "@/server/profile/report";

const params = z.object({ format: z.enum(["csv", "xlsx", "pdf"]), lang: z.enum(["ar", "en"]).default("ar") });

/**
 * Downloads the signed-in agent's own report (tables summary, daily, byReason, details) as CSV, Excel or PDF.
 * `from` and `to` (or `period`), `format`, `lang`. There is no way to name another user: it is always the caller's own work.
 */
export const GET = route(
  { rateLimit: { name: "me-report-export", limit: 20, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => {
    const { format, lang } = params.parse({ format: query.get("format"), lang: query.get("lang") ?? undefined });
    const q = reportQuery.parse({
      period: query.get("period") ?? undefined,
      from: query.get("from") ?? undefined,
      to: query.get("to") ?? undefined,
    });
    const file = await buildMyReportExport(actor, q, format, lang, actor.auth.user.displayName);
    await audit({ ...auditMeta(actor), action: "report.exported", entityType: "agent_report", after: { format, lang, ...q } });
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(file.body.length),
      },
    });
  },
);
