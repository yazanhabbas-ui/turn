"use client";

import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLookups, useText } from "../use-lookups";
import { AnnouncementDialog } from "./announcement-dialog";
import type { Announcement } from "./types";

const ANNOUNCEMENTS = "/api/v1/admin/announcements";

export function AnnouncementsTab() {
  const t = useTranslations("screens");
  const tu = useTranslations("ui");
  const locale = useLocale();
  const text = useText();
  const lookups = useLookups();
  const list = useApiQuery<{ items: Announcement[] }>(ANNOUNCEMENTS);
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const remove = useApiMutation((id: string) => api(`${ANNOUNCEMENTS}/${id}`, { method: "DELETE" }), {
    invalidate: [[ANNOUNCEMENTS]],
  });

  if (list.isLoading || lookups.isLoading) return <LoadingRows />;
  if (list.isError || !list.data || !lookups.data) return <ErrorState onRetry={() => list.refetch()} />;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const window_ = (a: Announcement) => {
    if (!a.startsAt && !a.endsAt) return t("ann.always");
    return `${a.startsAt ? fmt.format(new Date(a.startsAt)) : "…"} → ${a.endsAt ? fmt.format(new Date(a.endsAt)) : "…"}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("ann.add")}
        </Button>
      </div>
      {list.data.items.length === 0 ? (
        <EmptyState title={t("ann.empty")} />
      ) : (
        list.data.items.map((a) => (
          <div key={a.id} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
            {a.kind === "slide" && a.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.mediaUrl} alt="" className="h-12 w-20 rounded-md border object-cover" />
            ) : (
              <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
                <Megaphone className="size-5" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span className="truncate">{text(a.body, "—")}</span>
                <Badge variant="secondary">{t(`ann.kinds.${a.kind}`)}</Badge>
                <Badge variant={a.isActive ? "default" : "outline"}>{a.isActive ? tu("active") : tu("inactive")}</Badge>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {a.branchId ? text(lookups.data!.branches.find((b) => b.id === a.branchId)?.name) : tu("allBranches")} ·{" "}
                {window_(a)}
                {a.kind === "slide" && ` · ${t("ann.seconds", { count: a.durationSeconds })}`}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(a)}>
              <Pencil aria-hidden />
            </Button>
            <ConfirmButton
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              label={tu("delete")}
              title={tu("confirmDelete")}
              description={tu("confirmDeleteBody")}
              onConfirm={() => remove.mutateAsync(a.id)}
            />
          </div>
        ))
      )}
      <AnnouncementDialog
        branches={lookups.data.branches}
        item={editing === "new" ? null : editing}
        count={list.data.items.length}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}
