"use client";

import { Copy, KeyRound, Lock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ErrorState, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PERMISSION_GROUPS, type PermissionGroup } from "@/domain/rbac/permissions";
import { LOCALE_CODES } from "@/i18n/locales";
import type { L, RoleRow } from "../types";
import { LOOKUPS, useText } from "../use-lookups";

const ROLES = "/api/v1/admin/roles";

export function RolesPage({ canManage }: { canManage: boolean }) {
  const t = useTranslations("roles");
  const text = useText();
  const roles = useApiQuery<{ items: RoleRow[] }>(ROLES);
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);

  const clone = useApiMutation(
    (role: RoleRow) => {
      const name: L = {};
      for (const code of LOCALE_CODES) if (role.name[code]) name[code] = t("cloneName", { name: role.name[code] });
      return api<{ id: string }>(`${ROLES}/${role.id}/clone`, { body: { name } });
    },
    { invalidate: [[ROLES], [LOOKUPS]], success: t("created") },
  );

  return (
    <div className="mx-auto max-w-6xl">
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
      {roles.isLoading ? (
        <LoadingRows />
      ) : roles.isError ? (
        <ErrorState onRetry={() => roles.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.data!.items.map((r) => (
            <div key={r.id} className="bg-card flex flex-col rounded-xl border p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="bg-brand/10 text-brand grid size-10 shrink-0 place-items-center rounded-lg">
                  {r.isSystem ? <Lock className="size-5" aria-hidden /> : <KeyRound className="size-5" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{text(r.name)}</h2>
                    <Badge variant={r.isSystem ? "secondary" : "outline"}>{r.isSystem ? t("system") : t("custom")}</Badge>
                  </div>
                  {r.description && <p className="text-muted-foreground mt-1 text-sm">{text(r.description)}</p>}
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t("users", { count: r.userCount })} · {t("permissionsCount", { count: r.permissions.length })}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                  {r.isSystem || !canManage ? t("view") : t("edit")}
                </Button>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => clone.mutate(r)} disabled={clone.isPending}>
                    <Copy aria-hidden />
                    {t("clone")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <RoleDialog
        role={editing === "new" ? null : editing}
        open={editing !== null}
        readOnly={!canManage}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function RoleDialog({
  role,
  open,
  readOnly,
  onOpenChange,
}: {
  role: RoleRow | null;
  open: boolean;
  readOnly: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("roles");
  const tp = useTranslations("permissions");
  const tg = useTranslations("permissionGroups");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const [name, setName] = useState<L>({});
  const [description, setDescription] = useState<L>({});
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const locked = readOnly || !!role?.isSystem;

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? {});
    setDescription(role?.description ?? {});
    setPerms(new Set(role?.permissions ?? []));
  }, [open, role]);

  const invalidate = [[ROLES], [LOOKUPS]];
  const save = useApiMutation(
    () => {
      const body = { name, description, permissions: [...perms] };
      return role ? api(`${ROLES}/${role.id}`, { method: "PUT", body }) : api(ROLES, { body });
    },
    { invalidate, success: role ? t("saved") : t("created"), onSuccess: () => onOpenChange(false) },
  );
  const archive = useApiMutation(() => api(`${ROLES}/${role!.id}`, { method: "DELETE" }), {
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  const toggle = (key: string, on: boolean) =>
    setPerms((p) => {
      const n = new Set(p);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{role ? (locked ? t("view") : t("edit")) : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          {role?.isSystem && (
            <Alert>
              <AlertDescription>{t("readOnly")}</AlertDescription>
            </Alert>
          )}
          <fieldset disabled={locked} className="space-y-4">
            <LocalizedInput id="r-name" label={tu("name")} value={name} onChange={setName} required />
            <LocalizedInput id="r-desc" label={tu("description")} value={description} onChange={setDescription} />
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("permissions")}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {(Object.entries(PERMISSION_GROUPS) as [PermissionGroup, readonly string[]][]).map(([group, keys]) => {
                  const all = keys.every((k) => perms.has(k));
                  return (
                    <div key={group} className="rounded-lg border p-3">
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          className="accent-brand size-4"
                          checked={all}
                          onChange={(e) => keys.forEach((k) => toggle(k, e.target.checked))}
                        />
                        {tg(group)}
                      </label>
                      <div className="space-y-1.5 ps-6">
                        {keys.map((k) => (
                          <label key={k} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="accent-brand size-4"
                              checked={perms.has(k)}
                              onChange={(e) => toggle(k, e.target.checked)}
                            />
                            {tp(k)}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </fieldset>
          <DialogFooter className="gap-2">
            {role && !locked && (
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
              {tc("close")}
            </Button>
            {!locked && (
              <Button type="submit" disabled={save.isPending}>
                {tu("save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
