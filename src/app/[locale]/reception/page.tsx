import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";
import { ReceptionConsole } from "@/features/reception/reception-console";

export async function generateMetadata() {
  const t = await getTranslations("reception");
  return { title: t("title") };
}

export default async function ReceptionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <WorkspacePage locale={locale} area="reception" permission="tickets.issue">
      <ReceptionConsole />
    </WorkspacePage>
  );
}
