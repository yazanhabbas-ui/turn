import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { Link, redirect } from "@/i18n/navigation";
import { signupAvailable } from "@/server/admin/signups";
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
  const canSignUp = await signupAvailable();
  return (
    <AuthCard title={t("signInTitle")} subtitle={t("signInSubtitle")}>
      <Suspense>
        <LoginForm />
      </Suspense>
      {canSignUp && (
        <p className="text-muted-foreground mt-4 text-center text-sm">
          {t("noAccount")}{" "}
          <Link href="/signup" className="text-brand underline">
            {t("requestAccount")}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
