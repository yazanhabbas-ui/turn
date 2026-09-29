import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { ReasonEditor } from "@/features/admin/reasons/reason-editor";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("reasons");
  return { title: t("edit") };
}

/** `/admin/reasons/new` creates a reason; `/admin/reasons/<id>` edits one. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { auth, allowed } = await requireAuth(locale, "reasons.view");
  if (!allowed) return <Forbidden />;
  return <ReasonEditor id={id === "new" ? null : id} canManage={can(auth.grants, "reasons.manage")} />;
}
