import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { Building2, KeyRound, Monitor, ListChecks, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { desks, roles, visitReasons } from "@/db/schema";
import { can } from "@/domain/rbac/permissions";
import { visibleBranchIds } from "@/server/admin/branches";
import { listUsers } from "@/server/admin/users";
import { pickText } from "@/i18n/locales";
import { requireAuth } from "@/server/auth/current";

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale, "admin.access");
  const t = await getTranslations("admin");
  const org = auth.user.organizationId;

  // Counts only cover what this administrator may manage (a city admin does not learn about other cities).
  const actor = { auth };
  const branchIds = await visibleBranchIds(actor, "admin.access");
  const [[d], [r], [ro], userCount] = await Promise.all([
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
  ]);
  const b = { n: branchIds.length };
  const u = { n: userCount };

  const stats = [
    { key: "branches", value: b.n, icon: Building2 },
    { key: "desks", value: d.n, icon: Monitor },
    { key: "users", value: u.n, icon: Users },
    { key: "reasons", value: r.n, icon: ListChecks },
    { key: "roles", value: ro.n, icon: KeyRound },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold">{t("welcome", { name: pickText(auth.user.displayName, locale, auth.user.email) })}</h1>
      <p className="text-muted-foreground mt-1">{t("overviewHint")}</p>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.key} className="bg-card rounded-xl border p-4 shadow-sm">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <s.icon className="size-4" aria-hidden />
              {t(`stats.${s.key}`)}
            </div>
            <div className="tabular mt-2 text-3xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
