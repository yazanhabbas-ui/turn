import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { NotificationsPage } from "@/features/admin/notifications/notifications-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "admin.access");
  if (!allowed) return <Forbidden />;
  return (
    <NotificationsPage
      canOrganization={can(auth.grants, "settings.manage")}
      canTemplates={can(auth.grants, "templates.manage")}
    />
  );
}
