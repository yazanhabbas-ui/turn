import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";

export default async function AgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("workspace");
  return <WorkspacePage locale={locale} area="agent" permission="agent.serve" emptyText={t("agentEmpty")} />;
}
