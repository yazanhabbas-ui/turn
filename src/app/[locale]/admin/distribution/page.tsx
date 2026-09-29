import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { DistributionPage } from "@/features/admin/distribution/distribution-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("distribution");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { allowed } = await requireAuth(locale, "distribution.manage");
  if (!allowed) return <Forbidden />;
  return <DistributionPage />;
}
