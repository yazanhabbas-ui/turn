import { KeyRound } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/rbac/permissions";
import { ActivityFeed } from "@/features/profile/activity-feed";
import { AvatarEditor } from "@/features/profile/avatar-editor";
import { ProgressPanel } from "@/features/profile/progress-panel";
import { ReportsPanel } from "@/features/profile/reports-panel";
import { pickText } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { requireAuth } from "@/server/auth/current";
import { myProfile } from "@/server/profile/profile";

export async function generateMetadata() {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale);
  const t = await getTranslations("profile");
  const format = await getFormatter();
  const me = await myProfile({ auth });
  const name = pickText(me.displayName, locale, me.email);
  const scopeLabel = (r: (typeof me.roles)[number]) =>
    r.scope === "organization" ? t("scope.organization") : `${t(`scope.${r.scope}`)}: ${pickText(r.scopeName, locale)}`;

  return (
    <AppShell auth={auth} area="profile">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>

        <Card>
          <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <AvatarEditor user={{ id: me.id, displayName: me.displayName, email: me.email, avatarVersion: me.avatarVersion }} />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="text-xl font-bold">{name}</div>
                <div className="text-muted-foreground text-sm" dir="ltr">
                  {me.email}
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("roles")}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {me.roles.length === 0 && <span>{t("none")}</span>}
                    {me.roles.map((r, i) => (
                      <span key={i} className="bg-muted rounded-md px-2 py-0.5 text-xs">
                        {pickText(r.roleName, locale)} · {scopeLabel(r)}
                      </span>
                    ))}
                  </dd>
                </div>
                {me.agentBranch && (
                  <div>
                    <dt className="text-muted-foreground">{t("worksAt")}</dt>
                    <dd>{pickText(me.agentBranch, locale)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">{t("memberSince")}</dt>
                  <dd>{format.dateTime(new Date(me.createdAt), { dateStyle: "long" })}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("lastSignIn")}</dt>
                  <dd>
                    {me.lastLoginAt
                      ? format.dateTime(new Date(me.lastLoginAt), { dateStyle: "medium", timeStyle: "short" })
                      : t("none")}
                  </dd>
                </div>
              </dl>
              <Link href="/account" className="text-brand inline-flex items-center gap-1.5 text-sm underline underline-offset-4">
                <KeyRound className="size-4" aria-hidden />
                {t("securityLink")}
              </Link>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="progress-title" className="space-y-3">
          <h2 id="progress-title" className="text-lg font-semibold">
            {t("progressTitle")}
          </h2>
          <ProgressPanel />
        </section>

        {me.isAgent ? (
          <section aria-labelledby="reports-title" className="space-y-3">
            <h2 id="reports-title" className="text-lg font-semibold">
              {t("reports.title")}
            </h2>
            <ReportsPanel />
          </section>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("activityTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed showTickets={can(auth.grants, "tickets.issue")} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
