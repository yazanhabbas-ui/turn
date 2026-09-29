"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/admin/form";
import { api } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { useText } from "../use-lookups";

type Entry = {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: Record<string, string> | null;
  actorEmail: string | null;
  actorType: string;
  before: unknown;
  after: unknown;
  ip: string | null;
};

const ENTITY_TYPES = [
  "user",
  "role",
  "invite",
  "branch",
  "floor",
  "desk",
  "visit_reason",
  "agent_group",
  "schedule",
  "pause_window",
  "holiday",
  "priority_level",
  "break_type",
  "setting",
] as const;

export function AuditPage() {
  const t = useTranslations("audit");
  const format = useFormatter();
  const text = useText();
  const [entityType, setEntityType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["audit", entityType],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<{ items: Entry[]; nextBefore: string | null }>(
        `/api/v1/admin/audit?${new URLSearchParams({ ...(entityType && { entityType }), ...(pageParam && { before: pageParam }) })}`,
      ),
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <NativeSelect
            className="w-48"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            aria-label={t("entity")}
          >
            <option value="">{t("filterEntity")}</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {t(`entities.${e}`)}
              </option>
            ))}
          </NativeSelect>
        }
      />
      {q.isLoading ? (
        <LoadingRows rows={8} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !items.length ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="bg-card divide-y rounded-xl border">
          {items.map((e) => (
            <div key={e.id}>
              <button
                type="button"
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-start"
                onClick={() => setOpen(open === e.id ? null : e.id)}
                aria-expanded={open === e.id}
              >
                <div className="text-muted-foreground w-40 shrink-0 text-xs">
                  {format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}
                </div>
                <div className="w-44 shrink-0 truncate text-sm font-medium">
                  {e.actorName ? text(e.actorName, e.actorEmail ?? "") : t("system")}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs" dir="ltr">
                    {e.action}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {t.has(`entities.${e.entityType}`) ? t(`entities.${e.entityType}`) : e.entityType}
                  </span>
                </div>
                <ChevronDown
                  className={cn("text-muted-foreground size-4 transition", open === e.id && "rotate-180")}
                  aria-hidden
                />
              </button>
              {open === e.id && (
                <div className="bg-muted/30 grid gap-3 px-4 py-3 md:grid-cols-2">
                  {(["before", "after"] as const).map((k) => (
                    <div key={k}>
                      <p className="mb-1 text-xs font-semibold">{t(k)}</p>
                      <pre dir="ltr" className="bg-background max-h-72 overflow-auto rounded-md border p-2 text-xs">
                        {e[k] ? JSON.stringify(e[k], null, 2) : "—"}
                      </pre>
                    </div>
                  ))}
                  {e.ip && (
                    <p className="text-muted-foreground text-xs" dir="ltr">
                      IP {e.ip}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
