import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app/app-shell";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/features/account/change-password-form";
import { TwoFactorSettings } from "@/features/account/two-factor-settings";
import { requireAuth } from "@/server/auth/current";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale);
  const t = await getTranslations("account");

  return (
    <AppShell auth={auth} area="account">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t("preferences")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <span>{t("interfaceLanguage")}</span>
            <LanguageSwitcher signedIn />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("changePassword")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("twoFactor")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TwoFactorSettings enabled={auth.user.totpEnabled} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
