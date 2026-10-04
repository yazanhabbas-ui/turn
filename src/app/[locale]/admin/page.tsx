import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { Building2, CheckCircle2, Circle, KeyRound, ListChecks, Monitor, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { desks, displays, roles, visitReasons } from "@/db/schema";
import { can } from "@/domain/rbac/permissions";
import { visibleBranchIds } from "@/server/admin/branches";
import { listUsers } from "@/server/admin/users";
import { pickText } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { providerStatus } from "@/server/messaging/providers";
import { requireAuth } from "@/server/auth/current";
import { BackupCard } from "@/components/admin/backup-card";
import { CoverageCard } from "@/components/admin/coverage-card";

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale, "admin.access");
  const t = await getTranslations("admin");
  const org = auth.user.organizationId;

  // Counts only cover what this administrator may manage (a city admin does not learn about other cities).
  const actor = { auth };
  const branchIds = await visibleBranchIds(actor, "admin.access");
  const [[d], [r], [ro], userCount, [screens]] = await Promise.all([
    branchIds.length
      ? db()
          .select({ n: count() })
          .from(desks)
          .where(and(inArray(desks.branchId, branchIds), isNull(desks.archivedAt)))
      : [{ n: 0 }],
    db()
      .select({ n: count() })
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt))),
    db()
      .select({ n: count() })
      .from(roles)
      .where(and(eq(roles.organizationId, org), isNull(roles.archivedAt))),
    can(auth.grants, "users.view") ? listUsers(actor).then((x) => x.length) : Promise.resolve(0),
    branchIds.length
      ? db()
          .select({ n: count() })
          .from(displays)
          .where(and(inArray(displays.branchId, branchIds), isNull(displays.archivedAt), eq(displays.kind, "display")))
      : [{ n: 0 }],
  ]);
  const b = { n: branchIds.length };
  const u = { n: userCount };

  const stats = [
    { key: "branches", value: b.n, icon: Building2, href: "/admin/branches", allowed: true },
    { key: "desks", value: d.n, icon: Monitor, href: "/admin/branches", allowed: true },
    { key: "users", value: u.n, icon: Users, href: "/admin/users", allowed: can(auth.grants, "users.view") },
    { key: "reasons", value: r.n, icon: ListChecks, href: "/admin/reasons", allowed: can(auth.grants, "reasons.view") },
    { key: "roles", value: ro.n, icon: KeyRound, href: "/admin/roles", allowed: can(auth.grants, "roles.view") },
  ] as const;

  // First-day checklist: only what this administrator can act on, and only until everything is in place.
  const emailOn = providerStatus().some((p) => p.channel === "email" && p.state !== "not_configured");
  const steps = [
    { key: "reasons", done: r.n > 0, href: "/admin/reasons", allowed: can(auth.grants, "reasons.view") },
    { key: "desks", done: d.n > 0, href: "/admin/branches", allowed: true },
    { key: "team", done: u.n > 1, href: "/admin/users", allowed: can(auth.grants, "users.invite") },
    { key: "screen", done: screens.n > 0, href: "/admin/screens", allowed: can(auth.grants, "displays.manage") },
    { key: "email", done: emailOn, href: "/admin/notifications", allowed: can(auth.grants, "settings.manage") },
  ].filter((s) => s.allowed);
  const stepsDone = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold">{t("welcome", { name: pickText(auth.user.displayName, locale, auth.user.email) })}</h1>
      <p className="text-muted-foreground mt-1">{t("overviewHint")}</p>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => {
          const card = (
            <>
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <s.icon className="size-4" aria-hidden />
                {t(`stats.${s.key}`)}
              </div>
              <div className="tabular mt-2 text-3xl font-bold">{s.value}</div>
            </>
          );
          return s.allowed ? (
            <Link
              key={s.key}
              href={s.href}
              className="bg-card hover:border-brand/50 hover:bg-brand/5 focus-visible:ring-ring/50 rounded-xl border p-4 shadow-sm transition-colors outline-none focus-visible:ring-3"
            >
              {card}
            </Link>
          ) : (
            <div key={s.key} className="bg-card rounded-xl border p-4 shadow-sm">
              {card}
            </div>
          );
        })}
      </div>
      {stepsDone < steps.length && (
        <section className="bg-card mt-4 rounded-xl border p-4 shadow-sm" aria-labelledby="getting-started">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="getting-started" className="font-semibold">
              {t("gettingStarted")}
            </h2>
            <span className="text-muted-foreground tabular text-sm">
              {t("gettingStartedProgress", { done: stepsDone, total: steps.length })}
            </span>
          </div>
          <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-brand h-full rounded-full transition-all"
              style={{ width: `${(stepsDone / steps.length) * 100}%` }}
            />
          </div>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className={cn(
                    "hover:bg-muted flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                    s.done ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {s.done ? (
                    <CheckCircle2 className="text-status-serving size-5 shrink-0" aria-label={t("stepDone")} />
                  ) : (
                    <Circle className="text-muted-foreground size-5 shrink-0" aria-hidden />
                  )}
                  <span>{t(`steps.${s.key}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <CoverageCard actor={actor} locale={locale} />
      <BackupCard actor={actor} />
    </div>
  );
}
