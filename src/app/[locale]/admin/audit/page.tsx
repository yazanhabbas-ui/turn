import { redirect } from "@/i18n/navigation";

/** The audit log moved into the Settings app; old links and bookmarks land there. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/settings/audit", locale });
}
