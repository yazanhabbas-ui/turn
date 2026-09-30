"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import { api } from "@/lib/api";
import type { ActivityItem } from "@/server/profile/activity";

type Page = { items: ActivityItem[]; nextBefore: string | null };
type Filter = "all" | "audit" | "tickets";

const VERBS = new Set(["created", "updated", "archived", "deleted"]);

/** "My activity": what the signed-in user did (audit trail) and the visitors they served or tickets they issued. */
export function ActivityFeed({ showTickets }: { showTickets: boolean }) {
  const t = useTranslations("profile.activity");
  const format = useFormatter();
  const locale = useLocale();
  const [type, setType] = useState<Filter>("all");
  const [days, setDays] = useState(30);

  const q = useInfiniteQuery({
    queryKey: ["me-activity", type, days],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page>(`/api/v1/me/activity?type=${type}&days=${days}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const action = (i: Extract<ActivityItem, { kind: "audit" }>) => {
    const key = `actions.${i.action.replace(/\./g, "_")}`;
    if (t.has(key)) return t(key);
    const verb = i.action.split(".").pop() ?? "";
    const entity = t.has(`entities.${i.entityType}`) ? t(`entities.${i.entityType}`) : i.entityType;
    return VERBS.has(verb) ? t(`verbs.${verb}`, { entity }) : i.action;
  };

  const minutes = (n: number) => t("minutes", { n: format.number(n, { maximumFractionDigits: 1 }) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          className="w-auto"
          value={type}
          onChange={(e) => setType(e.target.value as Filter)}
          aria-label={t("filterType")}
        >
          <option value="all">{t("types.all")}</option>
          <option value="audit">{t("types.audit")}</option>
          {showTickets && <option value="tickets">{t("types.tickets")}</option>}
        </NativeSelect>
        <NativeSelect
          className="w-auto"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label={t("filterDays")}
        >
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {t("lastDays", { n: d })}
            </option>
          ))}
        </NativeSelect>
      </div>

      {q.isPending ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : q.isError ? (
        <p className="text-destructive text-sm">{t("error")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              {i.kind === "audit" ? (
                <span>{action(i)}</span>
              ) : (
                <span className="space-y-0.5">
                  <span className="block">
                    <span className="font-semibold" dir="ltr">
                      {i.displayNumber}
                    </span>{" "}
                    {i.role === "issued" ? t("issued") : t("served")} · {pickText(i.reason, locale)}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {[
                      i.role === "served" ? (t.has(`status.${i.status}`) ? t(`status.${i.status}`) : i.status) : null,
                      i.outcome,
                      i.serviceMin !== null ? t("service", { time: minutes(i.serviceMin) }) : null,
                      i.waitMin !== null ? t("wait", { time: minutes(i.waitMin) }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              )}
              <time className="text-muted-foreground shrink-0 text-xs" dateTime={i.at}>
                {format.dateTime(new Date(i.at), { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ul>
      )}

      {q.hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? t("loading") : t("loadMore")}
        </Button>
      )}
    </div>
  );
}
