import { getTranslations, setRequestLocale } from "next-intl/server";
import { VisitorStatus } from "@/features/visitor/visitor-status";
import { redirect } from "@/i18n/navigation";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { resolveText } from "@/domain/pagecontent/text";
import { visitorTextsForTicket } from "@/server/pagecontent/service";
import { publicTicketStatus } from "@/server/queue/views";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("visitorStatus");
  return { title: t("title"), robots: { index: false } };
}

/** Public page behind the ticket's QR code. Opens in the language chosen at reception. */
export default async function TicketStatusPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const status = await publicTicketStatus(token);
  if (!status) {
    const t = await getTranslations("visitorStatus");
    // The ticket decides which wording applies; without one the organization-wide wording is used (D66).
    const texts = await visitorTextsForTicket(token);
    return (
      <p className="text-muted-foreground mx-auto mt-24 max-w-sm px-5 text-center">
        {resolveText(texts, "notFound", locale, {}, (id) => t(id))}
      </p>
    );
  }
  // The QR has no language prefix; show the visitor's own language the first time.
  if (locale === DEFAULT_LOCALE && status.language !== locale && isLocale(status.language)) {
    redirect({ href: `/t/${token}`, locale: status.language });
  }
  return <VisitorStatus token={token} initial={status} />;
}
