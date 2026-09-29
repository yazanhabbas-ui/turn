import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";

export default async function WallboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return <WorkspacePage locale={locale} area="wallboard" permission="wallboard.view" emptyText={t("comingNext")} />;
}
