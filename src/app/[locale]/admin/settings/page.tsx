import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { SettingsPage } from "@/features/admin/settings/settings-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { allowed } = await requireAuth(locale, "settings.manage");
  if (!allowed) return <Forbidden />;

  return <SettingsPage />;
}
