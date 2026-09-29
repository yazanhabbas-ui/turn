"use client";

import { Building2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REGION_TIMEZONES } from "@/domain/validation";
import type { Branch, Desk, Floor, L } from "../types";
import { LOOKUPS, useText } from "../use-lookups";
import { useListJoin } from "../use-list";

const BRANCHES = "/api/v1/admin/branches";
const invalidate = [[BRANCHES], [LOOKUPS]];

const WEEKEND_PRESETS: Record<string, number[]> = { friSat: [5, 6], fri: [5], satSun: [6, 0] };

function presetOf(days: number[]): string {
  const key = [...days].sort().join(",");
  return Object.entries(WEEKEND_PRESETS).find(([, v]) => [...v].sort().join(",") === key)?.[0] ?? "custom";
}

export function BranchesPage({ canManage }: { canManage: boolean }) {
  const t = useTranslations("branches");
  const branches = useApiQuery<{ items: Branch[] }>(BRANCHES);
  const [editing, setEditing] = useState<Branch | "new" | null>(null);

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
      {branches.isLoading ? (
        <LoadingRows />
      ) : branches.isError ? (
        <ErrorState onRetry={() => branches.refetch()} />
      ) : (
        <div className="space-y-6">
          {branches.data!.items.map((b) => (
            <BranchCard key={b.id} branch={b} canManage={canManage} onEdit={() => setEditing(b)} />
          ))}
        </div>
      )}
      <BranchDialog
        branch={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function BranchCard({ branch, canManage, onEdit }: { branch: Branch; canManage: boolean; onEdit: () => void }) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tw = useTranslations("weekdaysShort");
  const text = useText();
  const list = useListJoin();
  const [desk, setDesk] = useState<Desk | "new" | null>(null);
  const [floor, setFloor] = useState<Floor | "new" | null>(null);
  const archiveDesk = useApiMutation((id: string) => api(`/api/v1/admin/desks/${id}`, { method: "DELETE" }), { invalidate });
  const archiveFloor = useApiMutation((id: string) => api(`/api/v1/admin/floors/${id}`, { method: "DELETE" }), { invalidate });
  const floorName = (id: string | null) => (id ? text(branch.floors.find((f) => f.id === id)?.name) : "—");

  return (
    <section className="bg-card rounded-xl border shadow-sm">
      <header className="flex flex-wrap items-start gap-3 border-b p-4">
        <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{text(branch.name)}</h2>
            <Badge variant="outline" dir="ltr">
              {branch.code}
            </Badge>
            {branch.isDefault && (
              <Badge variant="secondary">
                <Star className="size-3" aria-hidden />
                {t("isDefault")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {branch.address && text(branch.address) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {text(branch.address)}
              </span>
            )}
            <span dir="ltr">{branch.timezone}</span>
            <span>
              {t("weekend")}: {list(branch.weekend.map((d) => tw(String(d))))}
            </span>
          </p>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            {tu("edit")}
          </Button>
        )}
      </header>

      <div className="grid gap-6 p-4 lg:grid-cols-[1fr_2fr]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">{t("floors")}</h3>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setFloor("new")}>
                <Plus aria-hidden />
                {t("addFloor")}
              </Button>
            )}
          </div>
          <ul className="space-y-1">
            {branch.floors.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                {text(f.name)}
                {canManage && (
                  <span className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setFloor(f)}>
                      <Pencil aria-hidden />
                    </Button>
                    <ConfirmButton
                      size="icon-sm"
                      variant="ghost"
                      icon={<Trash2 aria-hidden />}
                      label={tu("archive")}
                      title={tu("confirmArchive")}
                      description={tu("confirmArchiveBody")}
                      onConfirm={() => archiveFloor.mutateAsync(f.id)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium">{t("desks")}</h3>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => setDesk("new")}>
                <Plus aria-hidden />
                {t("addDesk")}
              </Button>
            )}
          </div>
          {branch.desks.length === 0 ? (
            <EmptyState title={t("noDesks")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("deskNumber")}</TableHead>
                    <TableHead>{tu("name")}</TableHead>
                    <TableHead>{t("floor")}</TableHead>
                    <TableHead>{t("zone")}</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branch.desks.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="tabular font-semibold">{d.number}</TableCell>
                      <TableCell>{text(d.name)}</TableCell>
                      <TableCell>{floorName(d.floorId)}</TableCell>
                      <TableCell>{d.zone ?? "—"}</TableCell>
                      {canManage && (
                        <TableCell className="text-end">
                          <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setDesk(d)}>
                            <Pencil aria-hidden />
                          </Button>
                          <ConfirmButton
                            size="icon-sm"
                            variant="ghost"
                            icon={<Trash2 aria-hidden />}
                            label={tu("archive")}
                            title={tu("confirmArchive")}
                            description={tu("confirmArchiveBody")}
                            onConfirm={() => archiveDesk.mutateAsync(d.id)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
      <DeskDialog
        branch={branch}
        desk={desk === "new" ? null : desk}
        open={desk !== null}
        onOpenChange={(o) => !o && setDesk(null)}
      />
      <FloorDialog
        branch={branch}
        floor={floor === "new" ? null : floor}
        open={floor !== null}
        onOpenChange={(o) => !o && setFloor(null)}
      />
    </section>
  );
}

function BranchDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: Branch | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdays");
  const blank = {
    code: "",
    name: {} as L,
    address: {} as L,
    timezone: "Asia/Riyadh",
    weekend: [5, 6],
    isDefault: false,
  };
  const [f, setF] = useState(blank);
  const [preset, setPreset] = useState("friSat");
  const timezones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...REGION_TIMEZONES, ...all.filter((z) => !REGION_TIMEZONES.includes(z))];
  }, []);

  useEffect(() => {
    if (!open) return;
    const v = branch
      ? { ...branch, address: branch.address ?? {} }
      : {
          code: "",
          name: {},
          address: {},
          timezone: "Asia/Riyadh",
          weekend: [5, 6],
          isDefault: false,
        };
    setF(v);
    setPreset(presetOf(v.weekend));
  }, [open, branch]);

  const save = useApiMutation(
    () => {
      const body = f;
      return branch ? api(`${BRANCHES}/${branch.id}`, { method: "PUT", body }) : api(BRANCHES, { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  const archive = useApiMutation(() => api(`${BRANCHES}/${branch!.id}`, { method: "DELETE" }), {
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{branch ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="b-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <LocalizedInput id="b-address" label={t("address")} value={f.address} onChange={(address) => setF({ ...f, address })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("code")} htmlFor="b-code">
              <Input
                id="b-code"
                dir="ltr"
                required
                pattern="[A-Za-z0-9_\-]+"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t("timezone")} htmlFor="b-tz">
              <NativeSelect id="b-tz" dir="ltr" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {timezones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("weekend")} htmlFor="b-weekend">
              <NativeSelect
                id="b-weekend"
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  if (WEEKEND_PRESETS[e.target.value]) setF({ ...f, weekend: WEEKEND_PRESETS[e.target.value] });
                }}
              >
                <option value="friSat">{t("weekendFriSat")}</option>
                <option value="fri">{t("weekendFri")}</option>
                <option value="satSun">{t("weekendSatSun")}</option>
                <option value="custom">{t("weekendCustom")}</option>
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                className="accent-brand size-4"
                checked={f.isDefault}
                onChange={(e) => setF({ ...f, isDefault: e.target.checked })}
              />
              {t("isDefault")}
            </label>
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap gap-3">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand size-4"
                    checked={f.weekend.includes(d)}
                    onChange={(e) =>
                      setF({ ...f, weekend: e.target.checked ? [...f.weekend, d] : f.weekend.filter((x) => x !== d) })
                    }
                  />
                  {tw(String(d))}
                </label>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            {branch && (
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

function DeskDialog({
  branch,
  desk,
  open,
  onOpenChange,
}: {
  branch: Branch;
  desk: Desk | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const [f, setF] = useState({ number: "", name: {} as L, floorId: "", zone: "", sortOrder: 0 });

  useEffect(() => {
    if (!open) return;
    const next = String(Math.max(0, ...branch.desks.map((d) => Number(d.number) || 0)) + 1);
    setF(
      desk
        ? { number: desk.number, name: desk.name, floorId: desk.floorId ?? "", zone: desk.zone ?? "", sortOrder: desk.sortOrder }
        : { number: next, name: {}, floorId: branch.floors[0]?.id ?? "", zone: "", sortOrder: branch.desks.length },
    );
  }, [open, desk, branch]);

  const save = useApiMutation(
    () => {
      const body = { ...f, floorId: f.floorId || null, zone: f.zone || null };
      return desk
        ? api(`/api/v1/admin/desks/${desk.id}`, { method: "PUT", body })
        : api(`${BRANCHES}/${branch.id}/desks`, { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{desk ? t("editDesk") : t("addDesk")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("deskNumber")} htmlFor="d-number" hint={t("deskNumberHint")}>
              <Input
                id="d-number"
                required
                maxLength={10}
                value={f.number}
                onChange={(e) => setF({ ...f, number: e.target.value })}
              />
            </Field>
            <Field label={t("floor")} htmlFor="d-floor">
              <NativeSelect id="d-floor" value={f.floorId} onChange={(e) => setF({ ...f, floorId: e.target.value })}>
                <option value="">{t("noFloor")}</option>
                {branch.floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {text(fl.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("zone")} htmlFor="d-zone" hint={t("zoneHint")}>
              <Input id="d-zone" maxLength={20} value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} />
            </Field>
            <Field label={tu("sortOrder")} htmlFor="d-sort">
              <Input
                id="d-sort"
                type="number"
                value={f.sortOrder}
                onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })}
              />
            </Field>
          </div>
          <LocalizedInput id="d-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
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

function FloorDialog({
  branch,
  floor,
  open,
  onOpenChange,
}: {
  branch: Branch;
  floor: Floor | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("branches");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const [name, setName] = useState<L>({});
  useEffect(() => {
    if (open) setName(floor?.name ?? {});
  }, [open, floor]);
  const save = useApiMutation(
    () => {
      const body = { name, sortOrder: floor?.sortOrder ?? branch.floors.length };
      return floor
        ? api(`/api/v1/admin/floors/${floor.id}`, { method: "PUT", body })
        : api(`${BRANCHES}/${branch.id}/floors`, { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("floors")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="f-name" label={tu("name")} value={name} onChange={setName} required />
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
