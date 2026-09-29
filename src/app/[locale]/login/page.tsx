import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { redirect } from "@/i18n/navigation";
import { getAuth } from "@/server/auth/current";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("signIn") };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const auth = await getAuth();
  if (auth?.twoFactorVerified) redirect({ href: "/", locale });
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("signInTitle")} subtitle={t("signInSubtitle")}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
