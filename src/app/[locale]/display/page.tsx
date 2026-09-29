import { setRequestLocale } from "next-intl/server";
import arMessages from "../../../../messages/ar.json";
import enMessages from "../../../../messages/en.json";
import { DisplayApp } from "@/features/display/display-app";
import type { Dicts } from "@/features/display/text";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Public waiting-room screen. It is a device, not a person: it authenticates with a pairing token kept in the
 * browser. Both languages' strings are passed down because the screen rotates between them.
 */
export default async function DisplayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const dicts: Dicts = { ar: arMessages.display, en: enMessages.display };
  return <DisplayApp dicts={dicts} defaultLang={locale === "en" ? "en" : "ar"} />;
}
