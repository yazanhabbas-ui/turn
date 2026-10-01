"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Pencil, Plus, ScanLine, Trash2, Unplug } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLookups, useText } from "../use-lookups";
import { DisplayDialog } from "./display-dialog";
import { KioskDialog } from "./kiosk-dialog";
import { PairingPanel } from "./pairing-panel";
import type { Display, Pairing } from "./types";

const DISPLAYS = "/api/v1/admin/displays";

function useRelative() {
  const locale = useLocale();
  const t = useTranslations("screens");
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  return (iso: string | null) => {
    if (!iso) return t("neverSeen");
    const secs = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const abs = Math.abs(secs);
    if (abs < 60) return rtf.format(secs, "second");
    if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
    return rtf.format(Math.round(secs / 86400), "day");
  };
}

export function ScreensTab() {
  const t = useTranslations("screens");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const relative = useRelative();
  const lookups = useLookups();
  const list = useQuery({
    queryKey: [DISPLAYS],
    queryFn: () => api<{ items: Display[] }>(DISPLAYS),
    refetchInterval: 15_000,
  });
  const [editing, setEditing] = useState<Display | "new" | null>(null);
  const [editingKiosk, setEditingKiosk] = useState<Display | "new" | null>(null);
  const [pairing, setPairing] = useState<{ name: string; pairing: Pairing; kind: "display" | "kiosk" } | null>(null);
  const invalidate = [[DISPLAYS]];

  const newCode = useApiMutation((d: Display) => api<Pairing>(`${DISPLAYS}/${d.id}/pairing`, { method: "POST", body: {} }), {
    invalidate,
  });
  const revoke = useApiMutation((id: string) => api(`${DISPLAYS}/${id}/revoke`, { method: "POST", body: {} }), {
    invalidate,
    success: tu("saved"),
  });
  const remove = useApiMutation((id: string) => api(`${DISPLAYS}/${id}`, { method: "DELETE" }), { invalidate });

  if (list.isLoading || lookups.isLoading) return <LoadingRows />;
  if (list.isError || !list.data || !lookups.data) return <ErrorState onRetry={() => list.refetch()} />;
  const branches = lookups.data.branches;

  function status(d: Display) {
    if (d.revoked) return <Badge variant="destructive">{t("status.revoked")}</Badge>;
    if (d.paired) return <Badge variant="secondary">{t("status.paired")}</Badge>;
    return <Badge variant="outline">{t("status.unpaired")}</Badge>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setEditingKiosk("new")}>
          <ScanLine aria-hidden />
          {t("kiosk.add")}
        </Button>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </div>
      {list.data.items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        list.data.items.map((d) => (
          <div key={d.id} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {d.name}
                {d.kind === "kiosk" && (
                  <Badge variant="secondary">
                    <ScanLine className="size-3" aria-hidden />
                    {t("kiosk.badge")}
                  </Badge>
                )}
                <Badge variant={d.online ? "default" : "outline"}>{d.online ? t("online") : t("offline")}</Badge>
                {status(d)}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {text(branches.find((b) => b.id === d.branchId)?.name, "—")} ·{" "}
                {d.kind === "kiosk" ? t("kiosk.type") : t(`layouts.${d.layout}.name`)} · {t("lastSeen")}: {relative(d.lastSeenAt)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => (d.kind === "kiosk" ? setEditingKiosk(d) : setEditing(d))}>
                <Pencil aria-hidden />
                {tu("edit")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={newCode.isPending}
                onClick={async () => {
                  const p = await newCode.mutateAsync(d);
                  setPairing({ name: d.name, pairing: p, kind: d.kind === "kiosk" ? "kiosk" : "display" });
                }}
              >
                <KeyRound aria-hidden />
                {t("newCode")}
              </Button>
              {d.kind === "kiosk" && d.paired && !d.revoked && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href="/kiosk" target="_blank" rel="noreferrer" />}
                >
                  <ExternalLink aria-hidden />
                  {t("kiosk.preview")}
                </Button>
              )}
              {d.paired && !d.revoked && (
                <ConfirmButton
                  icon={<Unplug aria-hidden />}
                  label={t("revoke")}
                  title={t("confirmRevoke")}
                  description={t("confirmRevokeBody")}
                  onConfirm={() => revoke.mutateAsync(d.id)}
                />
              )}
              <ConfirmButton
                variant="destructive"
                icon={<Trash2 aria-hidden />}
                label={tu("delete")}
                title={tu("confirmDelete")}
                description={tu("confirmDeleteBody")}
                onConfirm={() => remove.mutateAsync(d.id)}
              />
            </div>
          </div>
        ))
      )}
      <DisplayDialog
        branches={branches}
        display={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onCreated={(name, p) => setPairing({ name, pairing: p, kind: "display" })}
      />
      <KioskDialog
        branches={branches}
        kiosk={editingKiosk === "new" ? null : editingKiosk}
        open={editingKiosk !== null}
        onOpenChange={(o) => !o && setEditingKiosk(null)}
        onCreated={(name, p) => setPairing({ name, pairing: p, kind: "kiosk" })}
      />
      <Dialog open={pairing !== null} onOpenChange={(o) => !o && setPairing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("pairing.title", { name: pairing?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          {pairing && <PairingPanel pairing={pairing.pairing} kind={pairing.kind} />}
          <DialogFooter>
            <Button onClick={() => setPairing(null)}>{tc("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
