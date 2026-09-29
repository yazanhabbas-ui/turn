import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { UsersPage } from "@/features/admin/users/users-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "users.view");
  if (!allowed) return <Forbidden />;
  return <UsersPage canManage={can(auth.grants, "users.manage")} canInvite={can(auth.grants, "users.invite")} />;
}
