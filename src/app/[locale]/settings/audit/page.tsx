import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell, Forbidden } from "@/components/app/app-shell";
import { AuditPage } from "@/features/admin/audit/audit-page";
import { SettingsSidebar } from "@/features/admin/settings/settings-sidebar";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

/** The audit log lives in the Settings app, so only super admins (settings.manage) see it. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "settings.manage");
  return (
    <AppShell auth={auth} area="settings" sidebar={allowed ? <SettingsSidebar /> : undefined}>
      {allowed ? <AuditPage /> : <Forbidden />}
    </AppShell>
  );
}
