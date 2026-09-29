import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";

export default async function ReceptionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workspace");
  return <WorkspacePage locale={locale} area="reception" permission="tickets.issue" emptyText={t("receptionEmpty")} />;
}
