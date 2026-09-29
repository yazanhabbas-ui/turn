import { getTranslations, setRequestLocale } from "next-intl/server";
import { Forbidden } from "@/components/app/app-shell";
import { AuditPage } from "@/features/admin/audit/audit-page";
import { requireAuth } from "@/server/auth/current";

export async function generateMetadata() {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { allowed } = await requireAuth(locale, "audit.view");
  if (!allowed) return <Forbidden />;

  return <AuditPage />;
}
