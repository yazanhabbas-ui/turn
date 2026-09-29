import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";
import { can } from "@/domain/rbac/permissions";
import { ReportsPage } from "@/features/reports/reports-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale);
  return (
    <WorkspacePage locale={locale} area="reports" permission="reports.view">
      <ReportsPage canExport={can(auth.grants, "reports.export")} canSchedule={can(auth.grants, "reports.schedule")} />
    </WorkspacePage>
  );
}
