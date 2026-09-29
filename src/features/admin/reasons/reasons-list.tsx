"use client";

import { Plus, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { EntityIcon } from "@/components/app/entity-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import type { Reason } from "../types";
import { useText } from "../use-lookups";

export const REASONS = "/api/v1/admin/reasons";

export function ReasonsList({ canManage }: { canManage: boolean }) {
  const t = useTranslations("reasons");
  const tu = useTranslations("ui");
  const text = useText();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const reasons = useApiQuery<{ items: Reason[] }>(`${REASONS}?archived=${showArchived}`);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage && (
            <Button nativeButton={false} render={<Link href="/admin/reasons/new" />}>
              <Plus aria-hidden />
              {t("add")}
            </Button>
          )
        }
      />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-brand size-4"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {tu("showArchived")}
      </label>
      {reasons.isLoading ? (
        <LoadingRows />
      ) : reasons.isError ? (
        <ErrorState onRetry={() => reasons.refetch()} />
      ) : !reasons.data?.items.length ? (
        <EmptyState title={tu("noResults")} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tu("name")}</TableHead>
                <TableHead>{t("prefix")}</TableHead>
                <TableHead>{t("sla")}</TableHead>
                <TableHead>{t("expectedMinutes")}</TableHead>
                <TableHead>{t("assignments")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reasons.data.items.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/admin/reasons/${r.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ backgroundColor: r.color }}
                      >
                        <EntityIcon name={r.icon} className="size-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {text(r.name)}
                          {r.isFeatured && (
                            <Star className="text-brand-accent size-3.5 fill-current" aria-label={t("featured")} />
                          )}
                          {r.archivedAt && <Badge variant="outline">{tu("archived")}</Badge>}
                        </div>
                        <div className="text-muted-foreground text-xs" dir="ltr">
                          {r.code}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-base font-bold">
                      {r.prefix}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular">
                    {r.slaTargetWaitMinutes} {tu("minutes")}
                  </TableCell>
                  <TableCell className="tabular">
                    {r.expectedServiceMinutes} {tu("minutes")}
                  </TableCell>
                  <TableCell>
                    {r.assignments.length ? (
                      t("assignedCount", { count: r.assignments.length })
                    ) : (
                      <Badge variant="destructive">{t("assignedCount", { count: 0 })}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
