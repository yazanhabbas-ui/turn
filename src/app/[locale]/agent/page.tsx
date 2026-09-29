import { getTranslations, setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";
import { AgentWorkspaceView } from "@/features/agent/agent-workspace";

export async function generateMetadata() {
  const t = await getTranslations("agent");
  return { title: t("title") };
}

export default async function AgentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <WorkspacePage locale={locale} area="agent" permission="agent.serve">
      <AgentWorkspaceView />
    </WorkspacePage>
  );
}
