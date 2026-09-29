import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { GroupsPage } from "@/features/admin/groups/groups-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "reasons.view");
  if (!allowed) return <Forbidden />;
  return <GroupsPage canManage={can(auth.grants, "reasons.manage")} />;
}
