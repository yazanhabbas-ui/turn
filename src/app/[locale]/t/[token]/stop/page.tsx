import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import { StopForm } from "@/features/visitor/stop-form";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { redirect } from "@/i18n/navigation";
import { verifyStop } from "@/server/notifications/optout";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("visitorStatus.stop");
  return { title: t("title"), robots: { index: false } };
}

/** Target of the opt-out link in every SMS and email. Asks to confirm (so mail scanners cannot unsubscribe anyone). */
export default async function StopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { locale, token } = await params;
  const { s } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("visitorStatus.stop");
  const [ticket] = await db().select({ language: tickets.language }).from(tickets).where(eq(tickets.publicToken, token));
  if (!ticket || !s || !verifyStop(token, s)) {
    return <p className="text-muted-foreground mx-auto mt-24 max-w-sm px-5 text-center">{t("invalid")}</p>;
  }
  if (locale === DEFAULT_LOCALE && ticket.language !== locale && isLocale(ticket.language)) {
    redirect({ href: `/t/${token}/stop?s=${s}`, locale: ticket.language });
  }
  return <StopForm token={token} sig={s} />;
}
