import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/auth-card";
import { TwoFactorForm } from "@/features/auth/two-factor-form";
import { redirect } from "@/i18n/navigation";
import { getAuth } from "@/server/auth/current";

export default async function TwoFactorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const auth = await getAuth();
  if (!auth) redirect({ href: "/login", locale });
  else if (auth.twoFactorVerified) redirect({ href: "/", locale });
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("twoFactorTitle")} subtitle={t("twoFactorSubtitle")}>
      <Suspense>
        <TwoFactorForm />
      </Suspense>
    </AuthCard>
  );
}
