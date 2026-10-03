import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthCard } from "@/features/auth/auth-card";
import { SignupForm } from "@/features/auth/signup-form";
import { signupAvailable } from "@/server/admin/signups";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "signupPage" });
  return { title: t("title"), robots: { index: false } };
}

export const dynamic = "force-dynamic";

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("signupPage");
  const open = await signupAvailable();
  return (
    <AuthCard title={t("title")} subtitle={open ? t("subtitle") : undefined}>
      {open ? (
        <SignupForm locale={locale} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>{t("disabled")}</AlertDescription>
        </Alert>
      )}
    </AuthCard>
  );
}
