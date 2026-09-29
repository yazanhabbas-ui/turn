import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { SimulatePage } from "@/features/admin/simulate/simulate-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("simulate");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { allowed } = await requireAuth(locale, "distribution.simulate");
  if (!allowed) return <Forbidden />;
  return <SimulatePage />;
}
