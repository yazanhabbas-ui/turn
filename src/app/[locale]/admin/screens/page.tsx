import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { ScreensPage } from "@/features/admin/screens/screens-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("screens");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "displays.manage");
  if (!allowed) return <Forbidden />;
  return (
    <ScreensPage
      canAnnouncements={can(auth.grants, "announcements.manage")}
      canSettings={can(auth.grants, "settings.manage")}
      canTemplates={can(auth.grants, "templates.manage")}
    />
  );
}
