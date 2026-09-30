import { getTranslations, setRequestLocale } from "next-intl/server";
import { VisitorStatus } from "@/features/visitor/visitor-status";
import { redirect } from "@/i18n/navigation";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { publicTicketStatus } from "@/server/queue/views";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("visitorStatus.feedback");
  return { title: t("title"), robots: { index: false } };
}

/** The feedback link (`{feedbackLink}` in messages): the visitor page with the rating card in view. */
export default async function TicketFeedbackPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const status = await publicTicketStatus(token);
  if (!status) {
    const t = await getTranslations("visitorStatus");
    return <p className="text-muted-foreground mx-auto mt-24 max-w-sm px-5 text-center">{t("notFound")}</p>;
  }
  if (locale === DEFAULT_LOCALE && status.language !== locale && isLocale(status.language)) {
    redirect({ href: `/t/${token}/feedback`, locale: status.language });
  }
  return <VisitorStatus token={token} initial={status} focusFeedback />;
}
