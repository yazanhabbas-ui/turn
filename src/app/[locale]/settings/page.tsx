import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell, Forbidden } from "@/components/app/app-shell";
import { SettingsPage } from "@/features/admin/settings/settings-page";
import { SettingsSidebar } from "@/features/admin/settings/settings-sidebar";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

/** The Settings app: organization-wide configuration, for super admins (settings.manage) only. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "settings.manage");
  return (
    <AppShell auth={auth} area="settings" sidebar={allowed ? <SettingsSidebar /> : undefined}>
      {allowed ? <SettingsPage organization /> : <Forbidden />}
    </AppShell>
  );
}
