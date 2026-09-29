import { MonitorOff } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

/** Public display entry point. Device pairing and the live layouts ship with the display milestone. */
export default async function DisplayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("display");
  return (
    <div className="dark grid min-h-dvh place-items-center bg-neutral-950 p-8 text-center text-neutral-100">
      <div>
        <MonitorOff className="mx-auto size-24 text-neutral-500" aria-hidden />
        <h1 className="mt-8 text-5xl font-bold">{t("notPaired")}</h1>
        <p className="mt-4 text-2xl text-neutral-400">{t("pairHint")}</p>
      </div>
    </div>
  );
}
