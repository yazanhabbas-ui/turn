import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { PrivacyPage } from "@/features/admin/privacy/privacy-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { allowed } = await requireAuth(locale, "visitors.privacy");
  if (!allowed) return <Forbidden />;
  return <PrivacyPage />;
}
