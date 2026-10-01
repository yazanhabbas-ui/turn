import { TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { issuingCoverage } from "@/server/admin/coverage";
import type { Actor } from "@/server/admin/actor";
import { Link } from "@/i18n/navigation";
import { pickText } from "@/i18n/locales";

/**
 * Overview alert (D61): branches where nobody can issue a ticket, because there is no receptionist, agent walk-in
 * issuing is off and no kiosk is paired. Renders nothing when every branch can issue. City admins see only their city.
 */
export async function CoverageCard({ actor, locale }: { actor: Actor; locale: string }) {
  let rows;
  try {
    rows = (await issuingCoverage(actor)).filter((b) => !b.canIssue);
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const t = await getTranslations("coverage");
  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/5 mt-4 rounded-xl border p-4 shadow-sm"
      data-testid="coverage-card"
    >
      <div className="text-destructive flex items-center gap-2 font-semibold">
        <TriangleAlert className="size-4" aria-hidden />
        {t("cardTitle", { count: rows.length })}
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t("cardBody")}</p>
      <ul className="mt-2 list-disc ps-5 text-sm">
        {rows.slice(0, 6).map((b) => (
          <li key={b.branchId}>{pickText(b.name, locale, "—")}</li>
        ))}
        {rows.length > 6 && <li>{t("more", { count: rows.length - 6 })}</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/admin/branches" className="text-brand underline">
          {t("goBranches")}
        </Link>
        <Link href="/admin/screens" className="text-brand underline">
          {t("addKiosk")}
        </Link>
      </div>
    </div>
  );
}
