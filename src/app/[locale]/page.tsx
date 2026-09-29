import { BarChart3, LayoutDashboard, MonitorPlay, Presentation, UserRoundCheck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app/app-shell";
import { can } from "@/domain/rbac/permissions";
import { Link, redirect } from "@/i18n/navigation";
import { AREAS } from "@/lib/areas";
import { requireAuth } from "@/server/auth/current";

const ICONS = {
  admin: LayoutDashboard,
  reception: UserRoundCheck,
  agent: MonitorPlay,
  reports: BarChart3,
  wallboard: Presentation,
} as const;

/** Sends users with a single workspace straight to it; otherwise lets them choose. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale);
  const areas = AREAS.filter((a) => can(auth.grants, a.permission));
  if (areas.length === 1) redirect({ href: areas[0].href, locale });
  const t = await getTranslations("areas");

  return (
    <AppShell auth={auth}>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">{t("chooseArea")}</h1>
        {areas.length === 0 ? (
          <p className="bg-muted/40 text-muted-foreground mt-4 rounded-lg border p-6">{t("noAreas")}</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {areas.map((a) => {
              const Icon = ICONS[a.key];
              return (
                <Link
                  key={a.key}
                  href={a.href}
                  className="group bg-card hover:border-brand flex min-h-28 items-center gap-4 rounded-2xl border p-6 shadow-sm transition hover:shadow-md"
                >
                  <span className="bg-brand/10 text-brand grid size-14 place-items-center rounded-xl">
                    <Icon className="size-7" aria-hidden />
                  </span>
                  <span className="text-lg font-semibold">{t(a.key)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
