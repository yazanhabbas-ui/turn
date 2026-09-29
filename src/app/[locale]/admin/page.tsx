import { and, count, eq, isNull } from "drizzle-orm";
import { Building2, KeyRound, Monitor, ListChecks, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db/client";
import { branches, desks, roles, users, visitReasons } from "@/db/schema";
import { pickText } from "@/i18n/locales";
import { requireAuth } from "@/server/auth/current";

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { auth } = await requireAuth(locale, "admin.access");
  const t = await getTranslations("admin");
  const org = auth.user.organizationId;

  const [[b], [d], [u], [r], [ro]] = await Promise.all([
    db()
      .select({ n: count() })
      .from(branches)
      .where(and(eq(branches.organizationId, org), isNull(branches.archivedAt))),
    db()
      .select({ n: count() })
      .from(desks)
      .where(and(eq(desks.organizationId, org), isNull(desks.archivedAt))),
    db()
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.organizationId, org), isNull(users.archivedAt))),
    db()
      .select({ n: count() })
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, org), isNull(visitReasons.archivedAt))),
    db()
      .select({ n: count() })
      .from(roles)
      .where(and(eq(roles.organizationId, org), isNull(roles.archivedAt))),
  ]);

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
