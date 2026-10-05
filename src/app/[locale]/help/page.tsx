import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app/app-shell";
import { HelpPage } from "@/features/help/help-page";
import { requireAuth } from "@/server/auth/current";
import { manualsFor, type ManualLang } from "@/server/help/manuals";

export async function generateMetadata() {
  const t = await getTranslations("help");
  return { title: t("title") };
}

/** Help center: the manuals for what this person does, in the language the app is shown in. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale);
  const lang: ManualLang = locale === "ar" ? "ar" : "en";
  const other: ManualLang = lang === "ar" ? "en" : "ar";
  return (
    <AppShell auth={auth} area="help">
      <HelpPage lang={lang} items={manualsFor(lang, auth.grants)} otherLang={other} otherItems={manualsFor(other, auth.grants)} />
    </AppShell>
  );
}
