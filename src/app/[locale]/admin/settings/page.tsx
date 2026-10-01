import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { branchesFor, can, citiesFor } from "@/domain/rbac/permissions";
import { SettingsPage } from "@/features/admin/settings/settings-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "admin.access");
  // Organization settings need settings.manage; a city admin edits their city and its branches, a branch manager their
  // branches, and both only the settings a city or branch may override.
  const organization = can(auth.grants, "settings.manage");
  if (!allowed || !(organization || can(auth.grants, "branches.manage"))) return <Forbidden />;

  return (
    <SettingsPage
      organization={organization}
      cityIds={citiesFor(auth.grants, "branches.manage")}
      branchIds={branchesFor(auth.grants, "branches.manage")}
    />
  );
}
