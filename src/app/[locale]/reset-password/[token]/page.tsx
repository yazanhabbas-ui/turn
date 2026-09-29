import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/features/auth/auth-card";
import { ResetPasswordForm } from "@/features/auth/invite-accept-form";
import { describeResetToken } from "@/server/admin/users";

export async function generateMetadata() {
  const t = await getTranslations("resetPage");
  return { title: t("title"), robots: { index: false } };
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("resetPage");
  const info = await describeResetToken(token);
  return (
    <AuthCard title={t("title")} subtitle={info ? t("subtitle", { email: info.email }) : undefined}>
      {info ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>{t("invalid")}</AlertDescription>
        </Alert>
      )}
    </AuthCard>
  );
}
