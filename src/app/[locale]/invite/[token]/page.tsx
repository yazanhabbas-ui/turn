import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/features/auth/auth-card";
import { InviteAcceptForm } from "@/features/auth/invite-accept-form";
import { pickText } from "@/i18n/locales";
import { describeInvite } from "@/server/admin/invites";

export async function generateMetadata() {
  const t = await getTranslations("invitePage");
  return { title: t("submit"), robots: { index: false } };
}

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("invitePage");
  const invite = await describeInvite(token);

  if (!invite) {
    return (
      <AuthCard title={t("title", { organization: "" }).trim()}>
        <Alert variant="destructive">
          <AlertDescription>{t("invalid")}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={t("title", { organization: pickText(invite.organizationName, locale) })}
      subtitle={t("subtitle", { role: pickText(invite.roleName, locale) })}
    >
      <InviteAcceptForm token={token} email={invite.email} displayName={invite.displayName} />
    </AuthCard>
  );
}
