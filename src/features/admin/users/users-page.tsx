"use client";

import { Lock, MailPlus, Search, ShieldCheck, UserPlus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { UserAvatar } from "@/components/app/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Lookups, UserRow } from "../types";
import { useLookups, useText } from "../use-lookups";
import { ChannelLabel, InviteDialog, INVITES, InviteResultView, type InviteResult } from "./invite-dialog";
import { UserDialog } from "./user-dialog";

type InviteRow = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: Record<string, string> | null;
  roleName: Record<string, string>;
  branchId: string | null;
  channel: string;
  expiresAt: string;
  status: "pending" | "used" | "expired" | "revoked";
};

export function UsersPage({ canManage, canInvite }: { canManage: boolean; canInvite: boolean }) {
  const t = useTranslations("users");
  const ti = useTranslations("invites");
  const lookups = useLookups();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [dialog, setDialog] = useState<"user" | "invite" | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          lookups.data && (
            <>
              {canInvite && (
                <Button variant="outline" onClick={() => setDialog("invite")}>
                  <MailPlus aria-hidden />
                  {ti("invite")}
                </Button>
              )}
              {canManage && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialog("user");
                  }}
                >
                  <UserPlus aria-hidden />
                  {t("add")}
                </Button>
              )}
            </>
          )
        }
      />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">{t("title")}</TabsTrigger>
          {canInvite && <TabsTrigger value="invites">{ti("title")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="users" className="mt-4">
          {lookups.data && (
            <UsersTable
              lookups={lookups.data}
              onEdit={(u) => {
                if (!canManage) return;
                setEditing(u);
                setDialog("user");
              }}
            />
          )}
        </TabsContent>
        {canInvite && (
          <TabsContent value="invites" className="mt-4">
            {lookups.data && <InvitesTable lookups={lookups.data} />}
          </TabsContent>
        )}
      </Tabs>
      {lookups.data && (
        <>
          <UserDialog
            user={editing}
            lookups={lookups.data}
            open={dialog === "user"}
            onOpenChange={(o) => !o && setDialog(null)}
          />
          <InviteDialog lookups={lookups.data} open={dialog === "invite"} onOpenChange={(o) => !o && setDialog(null)} />
        </>
      )}
    </div>
  );
}

function UsersTable({ lookups, onEdit }: { lookups: Lookups; onEdit: (u: UserRow) => void }) {
  const t = useTranslations("users");
  const tu = useTranslations("ui");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const text = useText();
  const [q, setQ] = useState("");
  const [roleId, setRoleId] = useState("");
  const [status, setStatus] = useState("");
  const deferred = useDeferredValue(q);
  const params = new URLSearchParams({ ...(deferred && { q: deferred }), ...(roleId && { roleId }), ...(status && { status }) });
  const users = useApiQuery<{ items: UserRow[] }>(`/api/v1/admin/users?${params}`);
  const roleName = (id: string) => text(lookups.roles.find((r) => r.id === id)?.name);
  const scopeLabel = (g: { branchId: string | null; cityId?: string | null }) =>
    g.cityId
      ? text(lookups.cities.find((c) => c.id === g.cityId)?.name)
      : g.branchId
        ? text(lookups.branches.find((b) => b.id === g.branchId)?.name)
        : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-2.5 size-4" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tu("searchPlaceholder")}
            className="ps-8"
            aria-label={tu("searchPlaceholder")}
          />
        </div>
        <NativeSelect className="w-44" value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label={t("role")}>
          <option value="">{t("filterRole")}</option>
          {lookups.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {text(r.name)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tu("status")}>
          <option value="">{t("filterStatus")}</option>
          <option value="active">{tu("active")}</option>
          <option value="inactive">{tu("inactive")}</option>
        </NativeSelect>
      </div>
      {users.isLoading ? (
        <LoadingRows />
      ) : users.isError ? (
        <ErrorState onRetry={() => users.refetch()} />
      ) : !users.data?.items.length ? (
        <EmptyState title={tu("noResults")} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tu("name")}</TableHead>
                <TableHead>{t("roles")}</TableHead>
                <TableHead>{tu("status")}</TableHead>
                <TableHead>{t("lastLogin")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.items.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => onEdit(u)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar user={u} size="sm" />
                      <div>
                        <div className="font-medium">{text(u.displayName, u.email)}</div>
                        <div className="text-muted-foreground text-xs" dir="ltr">
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.grants.map((g) => (
                        <Badge key={`${g.roleId}${g.branchId}${g.cityId}`} variant="secondary">
                          {roleName(g.roleId)}
                          {scopeLabel(g) && <span className="text-muted-foreground"> · {scopeLabel(g)}</span>}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={u.isActive ? "outline" : "destructive"}>{u.isActive ? tu("active") : tu("inactive")}</Badge>
                      {u.agent?.shiftId && (
                        <Badge variant="secondary" title={t("shift")}>
                          {text(lookups.shifts.find((sh) => sh.id === u.agent?.shiftId)?.name)}
                        </Badge>
                      )}
                      {u.totpEnabled && <ShieldCheck className="text-status-serving size-4" aria-label={t("twoFactor")} />}
                      {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                        <Lock className="text-destructive size-4" aria-label={t("locked")} />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {u.lastLoginAt ? format.relativeTime(new Date(u.lastLoginAt), now) : tu("never")}
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

function InvitesTable({ lookups }: { lookups: Lookups }) {
  const t = useTranslations("invites");
  const tu = useTranslations("ui");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const text = useText();
  const invites = useApiQuery<{ items: InviteRow[] }>(INVITES);
  const [result, setResult] = useState<InviteResult | null>(null);
  const resend = useApiMutation((id: string) => api<InviteResult>(`${INVITES}/${id}`, { body: { channels: [] } }), {
    invalidate: [[INVITES]],
    onSuccess: setResult,
  });
  const revoke = useApiMutation((id: string) => api(`${INVITES}/${id}`, { method: "DELETE" }), { invalidate: [[INVITES]] });
  const variant = { pending: "secondary", used: "outline", expired: "outline", revoked: "destructive" } as const;

  if (invites.isLoading) return <LoadingRows />;
  if (invites.isError) return <ErrorState onRetry={() => invites.refetch()} />;
  if (!invites.data?.items.length) return <EmptyState title={t("empty")} />;

  return (
    <>
      <div className="bg-card overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("recipient")}</TableHead>
              <TableHead>{tu("status")}</TableHead>
              <TableHead>{t("expires")}</TableHead>
              <TableHead className="text-end">{tu("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.data.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <div className="font-medium">{text(i.displayName, i.email ?? i.phone ?? "")}</div>
                  <div className="text-muted-foreground text-xs">
                    <span dir="ltr">{i.email ?? i.phone}</span> · {text(i.roleName)}
                    {i.branchId && ` · ${text(lookups.branches.find((b) => b.id === i.branchId)?.name)}`}
                    {i.channel !== "link" && (
                      <>
                        {" · "}
                        <ChannelLabel channel={i.channel as "email"} />
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={variant[i.status]}>{t(`status.${i.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{format.relativeTime(new Date(i.expiresAt), now)}</TableCell>
                <TableCell>
                  {(i.status === "pending" || i.status === "expired") && (
                    <div className="flex justify-end gap-1">
                      <ConfirmButton
                        label={t("resend")}
                        title={t("resendTitle")}
                        description={t("resendBody")}
                        onConfirm={() => resend.mutateAsync(i.id)}
                      />
                      {i.status === "pending" && (
                        <ConfirmButton
                          variant="destructive"
                          label={t("revoke")}
                          title={t("revokeTitle")}
                          onConfirm={() => revoke.mutateAsync(i.id)}
                        />
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("resend")}</DialogTitle>
          </DialogHeader>
          {result && <InviteResultView result={result} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
