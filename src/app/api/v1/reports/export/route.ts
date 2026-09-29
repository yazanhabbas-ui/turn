import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { auditMeta } from "@/server/admin/actor";
import { route } from "@/server/http/route";
import { buildExport } from "@/server/reports/export";
import { buildReport, filtersFromQuery } from "@/server/reports/service";

const params = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  locale: z.enum(["ar", "en"]).default("ar"),
});

/**
 * Downloads the report as CSV, Excel or PDF. Same filters as the overview. Needs `reports.export`; the branch scope of
 * `reports.view` is enforced by `buildReport`.
 */
export const GET = route(
  { permission: "reports.export", rateLimit: { name: "report-export", limit: 20, windowMs: 60_000, by: "user" } },
  async ({ actor, query }) => {
    const { format, locale } = params.parse({ format: query.get("format"), locale: query.get("locale") ?? undefined });
    const report = await buildReport(actor, filtersFromQuery(query));
    const file = await buildExport(report, format, locale);
    await audit({
      ...auditMeta(actor),
      branchId: report.filters.branchId ?? null,
      action: "report.exported",
      entityType: "report",
      after: { format, locale, ...report.filters },
    });
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(file.body.length),
      },
    });
  },
);
