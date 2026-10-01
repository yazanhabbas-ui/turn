"use client";

import { DoorOpen, Minus, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AgentMultiPicker, type PickerOption } from "@/components/admin/agent-picker";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, Field, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { useCoverage } from "../coverage/coverage";
import type { Branch, Hall, L, Reason } from "../types";
import { LOOKUPS, useText } from "../use-lookups";

const BRANCHES = "/api/v1/admin/branches";
const REASONS = "/api/v1/admin/reasons?archived=false";
const invalidate = [[BRANCHES], [LOOKUPS]];

/** Halls of one branch (D62): rooms where one host receives several visitors together. */
export function HallsBlock({ branch, canManage }: { branch: Branch; canManage: boolean }) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tcov = useTranslations("coverage");
  const text = useText();
  const coverage = useCoverage();
  const [hall, setHall] = useState<Hall | "new" | null>(null);
  const archive = useApiMutation((id: string) => api(`/api/v1/admin/halls/${id}`, { method: "DELETE" }), { invalidate });
  const halls = branch.halls ?? [];
  const cov = coverage.data?.items.find((c) => c.branchId === branch.id);
  const off = cov ? !cov.hallsEnabled : false;
  // Nothing to show for a branch that does not use halls and cannot add any.
  if (!halls.length && !canManage) return null;
  const floorName = (id: string | null) => (id ? text(branch.floors.find((f) => f.id === id)?.name) : "—");

  return (
    <div className="border-t p-4" data-testid={`halls-${branch.id}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-medium">
          <DoorOpen className="size-4" aria-hidden />
          {t("halls")}
        </h3>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setHall("new")}>
            <Plus aria-hidden />
            {t("addHall")}
          </Button>
        )}
      </div>
      {off && (
        <p className="bg-muted text-muted-foreground mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {t("hallsOff")}
          <Link href="/admin/settings" className="text-brand underline">
            {t("hallsOffAction")}
          </Link>
        </p>
      )}
      {halls.length === 0 ? (
        <EmptyState title={t("noHalls")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("hallNumber")}</TableHead>
                <TableHead>{tu("name")}</TableHead>
                <TableHead>{t("hallCapacity")}</TableHead>
                <TableHead>{t("floor")}</TableHead>
                <TableHead>{t("zone")}</TableHead>
                <TableHead>{t("hallReasons")}</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {halls.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular font-semibold">{h.number}</TableCell>
                  <TableCell>{text(h.name)}</TableCell>
                  <TableCell className="tabular">{t("capacityValue", { count: h.capacity })}</TableCell>
                  <TableCell>{floorName(h.floorId)}</TableCell>
                  <TableCell>{h.zone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {h.reasonIds.length ? t("reasonsCount", { count: h.reasonIds.length }) : t("allHallReasons")}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setHall(h)}>
                        <Pencil aria-hidden />
                      </Button>
                      <ConfirmButton
                        size="icon-sm"
                        variant="ghost"
                        icon={<Trash2 aria-hidden />}
                        label={tu("archive")}
                        title={tu("confirmArchive")}
                        description={tu("confirmArchiveBody")}
                        onConfirm={() => archive.mutateAsync(h.id)}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {cov && cov.hallGaps.length > 0 && (
        <ul className="text-destructive mt-2 space-y-1 text-sm" data-testid={`hall-gaps-${branch.id}`}>
          {cov.hallGaps.map((g) => (
            <li key={g.type}>{tcov(`hallGap.${g.type}`)}</li>
          ))}
        </ul>
      )}
      <HallDialog
        branch={branch}
        hall={hall === "new" ? null : hall}
        open={hall !== null}
        onOpenChange={(o) => !o && setHall(null)}
      />
    </div>
  );
}

function HallDialog({
  branch,
  hall,
  open,
  onOpenChange,
}: {
  branch: Branch;
  hall: Hall | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const reasons = useApiQuery<{ items: Reason[] }>(open ? REASONS : null);
  const [f, setF] = useState({
    number: "",
    name: {} as L,
    capacity: 10,
    floorId: "",
    zone: "",
    sortOrder: 0,
    reasonIds: [] as string[],
  });
  const hallReasons = useMemo(() => (reasons.data?.items ?? []).filter((r) => r.delivery === "hall"), [reasons.data]);
  const options = useMemo<PickerOption[]>(
    () =>
      hallReasons.map((r) => ({
        id: r.id,
        label: text(r.name, r.code),
        altLabels: Object.values(r.name ?? {}).filter(Boolean),
        code: r.code,
        subtitle: r.code,
      })),
    // `text` is derived from the locale only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hallReasons],
  );
  const halls = branch.halls ?? [];

  useEffect(() => {
    if (!open) return;
    const next = String(Math.max(0, ...halls.map((h) => Number(h.number) || 0)) + 1);
    setF(
      hall
        ? {
            number: hall.number,
            name: hall.name,
            capacity: hall.capacity,
            floorId: hall.floorId ?? "",
            zone: hall.zone ?? "",
            sortOrder: hall.sortOrder,
            reasonIds: hall.reasonIds,
          }
        : { number: next, name: {}, capacity: 10, floorId: "", zone: "", sortOrder: halls.length, reasonIds: [] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hall, branch.id]);

  const save = useApiMutation(
    () => {
      const body = { ...f, floorId: f.floorId || null, zone: f.zone || null };
      return hall
        ? api(`/api/v1/admin/halls/${hall.id}`, { method: "PUT", body })
        : api(`${BRANCHES}/${branch.id}/halls`, { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  const setCapacity = (n: number) => setF((s) => ({ ...s, capacity: Math.min(500, Math.max(2, Math.round(n) || 2)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{hall ? t("editHall") : t("addHall")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="h-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("hallNumber")} htmlFor="h-number" hint={t("hallNumberHint")}>
              <Input
                id="h-number"
                required
                maxLength={10}
                value={f.number}
                onChange={(e) => setF({ ...f, number: e.target.value })}
              />
            </Field>
            <Field label={t("hallCapacity")} htmlFor="h-capacity" hint={t("hallCapacityHint")}>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("capacityDown")}
                  disabled={f.capacity <= 2}
                  onClick={() => setCapacity(f.capacity - 1)}
                >
                  <Minus aria-hidden />
                </Button>
                <Input
                  id="h-capacity"
                  type="number"
                  min={2}
                  max={500}
                  required
                  className="tabular w-20 text-center"
                  value={f.capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("capacityUp")}
                  onClick={() => setCapacity(f.capacity + 1)}
                >
                  <Plus aria-hidden />
                </Button>
              </div>
            </Field>
            <Field label={t("floor")} htmlFor="h-floor">
              <NativeSelect id="h-floor" value={f.floorId} onChange={(e) => setF({ ...f, floorId: e.target.value })}>
                <option value="">{t("noFloor")}</option>
                {branch.floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {text(fl.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("zone")} htmlFor="h-zone" hint={t("zoneHint")}>
              <Input id="h-zone" maxLength={20} value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} />
            </Field>
          </div>
          <Field
            label={t("hallReasons")}
            htmlFor="h-reasons"
            hint={hallReasons.length ? t("hallReasonsHint") : t("noHallReasons")}
          >
            <AgentMultiPicker
              id="h-reasons"
              options={options}
              value={f.reasonIds}
              onChange={(reasonIds) => setF({ ...f, reasonIds })}
              placeholder={t("allHallReasons")}
              groupByBranch={false}
            />
          </Field>
          <DialogFooter>
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
