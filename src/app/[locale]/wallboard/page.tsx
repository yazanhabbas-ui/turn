import { setRequestLocale } from "next-intl/server";
import { WorkspacePage } from "@/components/app/workspace-page";
import { can } from "@/domain/rbac/permissions";
import { Wallboard } from "@/features/wallboard/wallboard";
import { requireAuth } from "@/server/auth/current";

export default async function WallboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale, "wallboard.view");
  return (
    <WorkspacePage locale={locale} area="wallboard" permission="wallboard.view">
      <Wallboard canAck={can(auth.grants, "alerts.manage")} />
    </WorkspacePage>
  );
}
