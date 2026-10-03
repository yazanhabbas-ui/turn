"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Lookups } from "../types";
import { useText } from "../use-lookups";

export const SIGNUPS = "/api/v1/admin/signups";

type SignupRow = {
  id: string;
  email: string;
  displayName: Record<string, string>;
  phone: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

/** Number of requests waiting for a decision, for the tab badge. */
export function usePendingSignups(enabled: boolean) {
  const q = useApiQuery<{ items: SignupRow[] }>(enabled ? SIGNUPS : null);
  return q.data?.items.filter((r) => r.status === "pending").length ?? 0;
}

function ApproveDialog({ request, lookups, onClose }: { request: SignupRow | null; lookups: Lookups; onClose: () => void }) {
  const t = useTranslations("signups");
  const tu = useTranslations("ui");
  const tUsers = useTranslations("users");
  const tc = useTranslations("common");
  const text = useText();
  const agentRole = lookups.roles.find((r) => r.key === "agent")?.id ?? lookups.roles[0]?.id ?? "";
  const defaultBranch = lookups.branches.find((b) => b.isDefault)?.id ?? lookups.branches[0]?.id ?? "";
  const [roleId, setRoleId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const role = roleId ?? agentRole;
  const branch = branchId ?? defaultBranch;
  const approve = useApiMutation(
    () => api(`${SIGNUPS}/${request!.id}/approve`, { body: { roleId: role, branchId: branch || null } }),
    {
      invalidate: [[SIGNUPS], ["/api/v1/admin/users"]],
      success: t("approved"),
      onSuccess: () => {
        setRoleId(null);
        setBranchId(null);
        onClose();
      },
    },
  );
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("approveTitle")}</DialogTitle>
          <DialogDescription>{t("approveHint", { email: request?.email ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={tUsers("role")} htmlFor="sr-role">
            <NativeSelect id="sr-role" value={role} onChange={(e) => setRoleId(e.target.value)}>
              {lookups.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {text(r.name)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={tu("branch")} htmlFor="sr-branch">
            <NativeSelect id="sr-branch" value={branch} onChange={(e) => setBranchId(e.target.value)}>
              {lookups.organizationScope && <option value="">{tu("allBranches")}</option>}
              {lookups.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {text(b.name)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>
            {t("approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SignupRequestsTable({ lookups }: { lookups: Lookups }) {
  const t = useTranslations("signups");
  const tu = useTranslations("ui");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const text = useText();
  const q = useApiQuery<{ items: SignupRow[] }>(SIGNUPS);
  const [approving, setApproving] = useState<SignupRow | null>(null);
  const reject = useApiMutation((id: string) => api(`${SIGNUPS}/${id}/reject`, { body: {} }), {
    invalidate: [[SIGNUPS]],
    success: t("rejected"),
  });
  const variant = { pending: "secondary", approved: "outline", rejected: "destructive" } as const;

  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState title={t("empty")} />;

  return (
    <>
      <div className="bg-card overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("applicant")}</TableHead>
              <TableHead>{tu("status")}</TableHead>
              <TableHead>{t("requested")}</TableHead>
              <TableHead className="text-end">{tu("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{text(r.displayName, r.email)}</div>
                  <div className="text-muted-foreground text-xs">
                    <span dir="ltr">{r.email}</span>
                    {r.phone && (
                      <>
                        {" · "}
                        <span dir="ltr">{r.phone}</span>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={variant[r.status]}>{t(`status.${r.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{format.relativeTime(new Date(r.createdAt), now)}</TableCell>
                <TableCell>
                  {r.status === "pending" && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setApproving(r)}>
                        {t("approve")}
                      </Button>
                      <ConfirmButton
                        variant="destructive"
                        label={t("reject")}
                        title={t("rejectTitle")}
                        description={t("rejectBody")}
                        onConfirm={() => reject.mutateAsync(r.id)}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ApproveDialog request={approving} lookups={lookups} onClose={() => setApproving(null)} />
    </>
  );
}
