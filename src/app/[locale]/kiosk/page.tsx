import { setRequestLocale } from "next-intl/server";
import arMessages from "../../../../messages/ar.json";
import enMessages from "../../../../messages/en.json";
import type { Dicts } from "@/features/display/text";
import { KioskApp } from "@/features/kiosk/kiosk-app";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Self check-in kiosk (D61). A device, not a person: it authenticates with the pairing token kept in the browser, so
 * there is no staff sign-in. Both languages' strings are passed down because the visitor switches between them.
 */
export default async function KioskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const dicts: Dicts = { ar: arMessages.kiosk, en: enMessages.kiosk };
  return <KioskApp dicts={dicts} defaultLang={locale === "en" ? "en" : "ar"} />;
}
