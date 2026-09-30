"use client";

import { Pencil, Plus, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { AgentMultiPicker, AgentPicker } from "@/components/admin/agent-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { Group, L, Lookups } from "../types";
import { LOOKUPS, useLookups, useText } from "../use-lookups";
import { useAgentOptions } from "../agent-options";
import { useListJoin } from "../use-list";

const GROUPS = "/api/v1/admin/groups";

export function GroupsPage({ canManage }: { canManage: boolean }) {
  const t = useTranslations("groups");
  const tu = useTranslations("ui");
  const text = useText();
  const list = useListJoin();
  const lookups = useLookups();
  const [editing, setEditing] = useState<Group | "new" | null>(null);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage && (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden />
              {t("add")}
            </Button>
          )
        }
      />
      {lookups.isLoading ? (
        <LoadingRows />
      ) : lookups.isError || !lookups.data ? (
        <ErrorState onRetry={() => lookups.refetch()} />
      ) : lookups.data.groups.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lookups.data.groups.map((g) => {
            const members = lookups.data!.agents.filter((a) => g.memberIds.includes(a.id));
            return (
              <div key={g.id} className="bg-card rounded-xl border p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
                    <UsersRound className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{text(g.name)}</h2>
                    <p className="text-muted-foreground text-xs">
                      {g.branchId ? text(lookups.data!.branches.find((b) => b.id === g.branchId)?.name) : tu("allBranches")} ·{" "}
                      {t("membersCount", { count: g.memberIds.length })}
                    </p>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(g)}>
                      <Pencil aria-hidden />
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-sm">{list(members.map((m) => text(m.displayName, m.email))) || "—"}</p>
              </div>
            );
          })}
        </div>
      )}
      {lookups.data && (
        <GroupDialog
          lookups={lookups.data}
          group={editing === "new" ? null : editing}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </div>
  );
}

function GroupDialog({
  lookups,
  group,
  open,
  onOpenChange,
}: {
  lookups: Lookups;
  group: Group | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("groups");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const agentOptions = useAgentOptions(lookups);
  const [f, setF] = useState({ name: {} as L, branchId: "", supervisorUserId: "", memberIds: [] as string[] });

  useEffect(() => {
    if (open)
      setF({
        name: group?.name ?? {},
        branchId: group?.branchId ?? "",
        supervisorUserId: group?.supervisorUserId ?? "",
        memberIds: group?.memberIds ?? [],
      });
  }, [open, group]);

  const invalidate = [[LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { ...f, branchId: f.branchId || null, supervisorUserId: f.supervisorUserId || null };
      return group ? api(`${GROUPS}/${group.id}`, { method: "PUT", body }) : api(GROUPS, { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  const archive = useApiMutation(() => api(`${GROUPS}/${group!.id}`, { method: "DELETE" }), {
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{group ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="g-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tu("branch")} htmlFor="g-branch">
              <NativeSelect id="g-branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                <option value="">{tu("allBranches")}</option>
                {lookups.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("supervisor")} htmlFor="g-sup">
              <AgentPicker
                id="g-sup"
                options={agentOptions}
                value={f.supervisorUserId}
                onChange={(supervisorUserId) => setF({ ...f, supervisorUserId })}
                placeholder={tu("none")}
              />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("members")}</legend>
            <AgentMultiPicker
              options={agentOptions}
              value={f.memberIds}
              onChange={(memberIds) => setF({ ...f, memberIds })}
              placeholder={t("addMembers")}
              aria-label={t("members")}
            />
          </fieldset>
          <DialogFooter className="gap-2">
            {group && (
              <ConfirmButton
                variant="destructive"
                label={tu("archive")}
                title={tu("confirmArchive")}
                description={tu("confirmArchiveBody")}
                onConfirm={() => archive.mutateAsync(undefined)}
              />
            )}
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tu("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
