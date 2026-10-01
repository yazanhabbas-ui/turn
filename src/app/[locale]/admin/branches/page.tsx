import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/domain/rbac/permissions";
import { BranchesPage } from "@/features/admin/branches/branches-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("branches");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale, "admin.access");
  return <BranchesPage canManage={can(auth.grants, "branches.manage")} canManageHalls={can(auth.grants, "halls.manage")} />;
}
