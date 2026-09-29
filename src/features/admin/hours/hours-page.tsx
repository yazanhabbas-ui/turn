"use client";

import { CalendarOff, Clock, Moon, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Branch, Holiday, L, PauseWindow, Schedule, ScheduleRule } from "../types";
import { LOOKUPS, useLookups, useText } from "../use-lookups";
import { useListJoin } from "../use-list";

const HOURS = "/api/v1/admin/schedules";
const invalidate = [[HOURS], [LOOKUPS]];
const WEEK = [0, 1, 2, 3, 4, 5, 6];
type Data = { schedules: Schedule[]; pauses: PauseWindow[]; holidays: Holiday[] };

export function HoursPage({ canManage }: { canManage: boolean }) {
  const t = useTranslations("hours");
  const data = useApiQuery<Data>(HOURS);
  const lookups = useLookups();
  const [schedule, setSchedule] = useState<Schedule | "new" | null>(null);
  const [pause, setPause] = useState<PauseWindow | "new" | null>(null);
  const [holiday, setHoliday] = useState<Holiday | "new" | null>(null);

  if (data.isLoading || lookups.isLoading) return <LoadingRows rows={6} />;
  if (data.isError || !data.data || !lookups.data) return <ErrorState onRetry={() => data.refetch()} />;
  const branches = lookups.data.branches;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      <SectionHeader
        icon={<Clock className="size-5" aria-hidden />}
        title={t("schedules")}
        action={canManage && <AddButton label={t("addSchedule")} onClick={() => setSchedule("new")} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {data.data.schedules.map((s) => (
          <ScheduleCard key={s.id} schedule={s} canManage={canManage} onEdit={() => setSchedule(s)} />
        ))}
      </div>

      <SectionHeader
        icon={<Moon className="size-5" aria-hidden />}
        title={t("pauses")}
        hint={t("pausesHint")}
        action={canManage && <AddButton label={t("addPause")} onClick={() => setPause("new")} />}
      />
      <PausesTable pauses={data.data.pauses} branches={branches} canManage={canManage} onEdit={setPause} />

      <SectionHeader
        icon={<CalendarOff className="size-5" aria-hidden />}
        title={t("holidays")}
        action={canManage && <AddButton label={t("addHoliday")} onClick={() => setHoliday("new")} />}
      />
      <HolidaysTable holidays={data.data.holidays} branches={branches} canManage={canManage} onEdit={setHoliday} />

      <ScheduleDialog
        schedule={schedule === "new" ? null : schedule}
        open={schedule !== null}
        onOpenChange={(o) => !o && setSchedule(null)}
      />
      <PauseDialog
        pause={pause === "new" ? null : pause}
        branches={branches}
        open={pause !== null}
        onOpenChange={(o) => !o && setPause(null)}
      />
      <HolidayDialog
        holiday={holiday === "new" ? null : holiday}
        branches={branches}
        open={holiday !== null}
        onOpenChange={(o) => !o && setHoliday(null)}
      />
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-brand">{icon}</span>
          {title}
        </h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus aria-hidden />
      {label}
    </Button>
  );
}

function ScheduleCard({ schedule, canManage, onEdit }: { schedule: Schedule; canManage: boolean; onEdit: () => void }) {
  const t = useTranslations("hours");
  const tw = useTranslations("weekdays");
  const tu = useTranslations("ui");
  const text = useText();
  const list = useListJoin();
  const intervals = (kind: string, day: number) =>
    list(schedule.rules.filter((r) => r.kind === kind && r.weekday === day).map((r) => `${r.opensAt}–${r.closesAt}`));
  return (
    <div className="bg-card rounded-xl border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{text(schedule.name)}</h3>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            {tu("edit")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>{t("regular")}</TableHead>
            <TableHead>{t("ramadan")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {WEEK.map((d) => (
            <TableRow key={d}>
              <TableCell className="font-medium">{tw(String(d))}</TableCell>
              <TableCell className="tabular">
                {intervals("regular", d) ? (
                  <span dir="ltr">{intervals("regular", d)}</span>
                ) : (
                  <span className="text-muted-foreground">{t("closed")}</span>
                )}
              </TableCell>
              <TableCell className="tabular">
                {intervals("ramadan", d) ? (
                  <span dir="ltr">{intervals("ramadan", d)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ScheduleDialog({
  schedule,
  open,
  onOpenChange,
}: {
  schedule: Schedule | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("hours");
  const tw = useTranslations("weekdays");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const [name, setName] = useState<L>({});
  const [rules, setRules] = useState<ScheduleRule[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? {});
    setRules(
      schedule?.rules.map(({ kind, weekday, opensAt, closesAt }) => ({ kind, weekday, opensAt, closesAt })) ??
        [0, 1, 2, 3, 4].map((weekday) => ({ kind: "regular", weekday, opensAt: "08:00", closesAt: "16:00" })),
    );
  }, [open, schedule]);

  const save = useApiMutation(
    () =>
      schedule ? api(`${HOURS}/${schedule.id}`, { method: "PUT", body: { name, rules } }) : api(HOURS, { body: { name, rules } }),
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  const archive = useApiMutation(() => api(`${HOURS}/${schedule!.id}`, { method: "DELETE" }), {
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  const dayEditor = (kind: "regular" | "ramadan", day: number) => {
    const items = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind && r.weekday === day);
    return (
      <div className="space-y-1">
        {items.map(({ r, i }) => (
          <div key={i} className="flex items-center gap-1" dir="ltr">
            <Input
              type="time"
              className="h-8 w-28"
              aria-label={t("opens")}
              value={r.opensAt}
              onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)))}
            />
            <span>–</span>
            <Input
              type="time"
              className="h-8 w-28"
              aria-label={t("closes")}
              value={r.closesAt}
              onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={tu("remove")}
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setRules([...rules, { kind, weekday: day, opensAt: "08:00", closesAt: "16:00" }])}
        >
          <Plus aria-hidden />
          {t("addInterval")}
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{schedule ? t("editSchedule") : t("addSchedule")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="s-name" label={tu("name")} value={name} onChange={setName} required />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>{t("regular")}</TableHead>
                  <TableHead>{t("ramadan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {WEEK.map((d) => (
                  <TableRow key={d}>
                    <TableCell className="align-top font-medium">{tw(String(d))}</TableCell>
                    <TableCell>{dayEditor("regular", d)}</TableCell>
                    <TableCell>{dayEditor("ramadan", d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="gap-2">
            {schedule && (
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

function PausesTable({
  pauses,
  branches,
  canManage,
  onEdit,
}: {
  pauses: PauseWindow[];
  branches: Branch[];
  canManage: boolean;
  onEdit: (p: PauseWindow) => void;
}) {
  const t = useTranslations("hours");
  const tu = useTranslations("ui");
  const tws = useTranslations("weekdaysShort");
  const text = useText();
  const list = useListJoin();
  const remove = useApiMutation((id: string) => api(`/api/v1/admin/pause-windows/${id}`, { method: "DELETE" }), { invalidate });
  if (!pauses.length) return <EmptyState title={t("empty")} />;
  return (
    <div className="bg-card overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tu("name")}</TableHead>
            <TableHead>{tu("branch")}</TableHead>
            <TableHead>{t("mode")}</TableHead>
            <TableHead>{t("days")}</TableHead>
            <TableHead>{t("season")}</TableHead>
            {canManage && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pauses.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {text(p.name)} {!p.isActive && <Badge variant="outline">{tu("inactive")}</Badge>}
              </TableCell>
              <TableCell>{text(branches.find((b) => b.id === p.branchId)?.name)}</TableCell>
              <TableCell className="tabular">
                {p.mode === "manual" ? (
                  <span dir="ltr">
                    {p.startsAt}–{p.endsAt}
                  </span>
                ) : (
                  `${t("modeAuto")} · ${t(`prayers.${p.prayer ?? "dhuhr"}`)} · ${p.durationMinutes} ${tu("minutes")}`
                )}
              </TableCell>
              <TableCell className="text-xs">
                {p.weekdays.length === 7 ? tu("all") : list(p.weekdays.map((d) => tws(String(d))))}
              </TableCell>
              <TableCell>
                {t(p.season === "always" ? "seasonAlways" : p.season === "ramadan" ? "seasonRamadan" : "seasonRegular")}
              </TableCell>
              {canManage && (
                <TableCell className="text-end whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => onEdit(p)}>
                    <Pencil aria-hidden />
                  </Button>
                  <ConfirmButton
                    size="icon-sm"
                    variant="ghost"
                    icon={<Trash2 aria-hidden />}
                    label={tu("delete")}
                    title={tu("confirmDelete")}
                    description={tu("confirmDeleteBody")}
                    onConfirm={() => remove.mutateAsync(p.id)}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PauseDialog({
  pause,
  branches,
  open,
  onOpenChange,
}: {
  pause: PauseWindow | null;
  branches: Branch[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("hours");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdays");
  const text = useText();
  const blank = (): Omit<PauseWindow, "id"> => ({
    branchId: branches[0]?.id ?? "",
    kind: "prayer",
    name: {},
    mode: "manual",
    prayer: "dhuhr",
    startsAt: "12:00",
    endsAt: "12:20",
    offsetMinutes: 0,
    durationMinutes: 20,
    weekdays: WEEK,
    season: "always",
    // Empty = the screen uses the organization's "prayer_pause" display template.
    message: {},
    isActive: true,
  });
  const [f, setF] = useState(blank);

  useEffect(() => {
    if (open) setF(pause ? { ...pause } : blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pause]);

  const save = useApiMutation(
    () => {
      const body = { ...f, message: f.message ?? {}, id: undefined };
      return pause
        ? api(`/api/v1/admin/pause-windows/${pause.id}`, { method: "PUT", body })
        : api("/api/v1/admin/pause-windows", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pause ? t("editPause") : t("addPause")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="p-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tu("branch")} htmlFor="p-branch">
              <NativeSelect id="p-branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("kind")} htmlFor="p-kind">
              <NativeSelect
                id="p-kind"
                value={f.kind}
                onChange={(e) =>
                  setF({
                    ...f,
                    kind: e.target.value as PauseWindow["kind"],
                    mode: e.target.value === "custom" ? "manual" : f.mode,
                  })
                }
              >
                <option value="prayer">{t("kindPrayer")}</option>
                <option value="custom">{t("kindCustom")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("mode")} htmlFor="p-mode">
              <NativeSelect
                id="p-mode"
                value={f.mode}
                disabled={f.kind === "custom"}
                onChange={(e) => setF({ ...f, mode: e.target.value as PauseWindow["mode"] })}
              >
                <option value="manual">{t("modeManual")}</option>
                <option value="auto">{t("modeAuto")}</option>
              </NativeSelect>
            </Field>
            {f.kind === "prayer" && (
              <Field label={t("prayer")} htmlFor="p-prayer">
                <NativeSelect id="p-prayer" value={f.prayer ?? "dhuhr"} onChange={(e) => setF({ ...f, prayer: e.target.value })}>
                  {(["fajr", "dhuhr", "asr", "maghrib", "isha"] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`prayers.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {f.mode === "manual" ? (
              <>
                <Field label={t("from")} htmlFor="p-start">
                  <Input
                    id="p-start"
                    type="time"
                    dir="ltr"
                    required
                    value={f.startsAt ?? ""}
                    onChange={(e) => setF({ ...f, startsAt: e.target.value })}
                  />
                </Field>
                <Field label={t("to")} htmlFor="p-end">
                  <Input
                    id="p-end"
                    type="time"
                    dir="ltr"
                    required
                    value={f.endsAt ?? ""}
                    onChange={(e) => setF({ ...f, endsAt: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("offset")} htmlFor="p-offset">
                  <Input
                    id="p-offset"
                    type="number"
                    min={-60}
                    max={120}
                    value={f.offsetMinutes}
                    onChange={(e) => setF({ ...f, offsetMinutes: Number(e.target.value) })}
                  />
                </Field>
                <Field label={t("duration")} htmlFor="p-duration">
                  <Input
                    id="p-duration"
                    type="number"
                    min={5}
                    max={120}
                    value={f.durationMinutes}
                    onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}
            <Field label={t("season")} htmlFor="p-season">
              <NativeSelect
                id="p-season"
                value={f.season}
                onChange={(e) => setF({ ...f, season: e.target.value as PauseWindow["season"] })}
              >
                <option value="always">{t("seasonAlways")}</option>
                <option value="ramadan">{t("seasonRamadan")}</option>
                <option value="regular">{t("seasonRegular")}</option>
              </NativeSelect>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("days")}</legend>
            <div className="flex flex-wrap gap-3">
              {WEEK.map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand size-4"
                    checked={f.weekdays.includes(d)}
                    onChange={(e) =>
                      setF({ ...f, weekdays: e.target.checked ? [...f.weekdays, d].sort() : f.weekdays.filter((x) => x !== d) })
                    }
                  />
                  {tw(String(d))}
                </label>
              ))}
            </div>
          </fieldset>
          <LocalizedInput id="p-msg" label={t("message")} value={f.message} onChange={(message) => setF({ ...f, message })} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={f.isActive}
              onChange={(e) => setF({ ...f, isActive: e.target.checked })}
            />
            {tu("active")}
          </label>
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

function HolidaysTable({
  holidays,
  branches,
  canManage,
  onEdit,
}: {
  holidays: Holiday[];
  branches: Branch[];
  canManage: boolean;
  onEdit: (h: Holiday) => void;
}) {
  const t = useTranslations("hours");
  const tu = useTranslations("ui");
  const text = useText();
  const remove = useApiMutation((id: string) => api(`/api/v1/admin/holidays/${id}`, { method: "DELETE" }), { invalidate });
  if (!holidays.length) return <EmptyState title={t("empty")} />;
  return (
    <div className="bg-card overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tu("name")}</TableHead>
            <TableHead>{tu("branch")}</TableHead>
            <TableHead>{t("from")}</TableHead>
            <TableHead>{t("to")}</TableHead>
            {canManage && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {holidays.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-medium">{text(h.name)}</TableCell>
              <TableCell>{h.branchId ? text(branches.find((b) => b.id === h.branchId)?.name) : tu("allBranches")}</TableCell>
              <TableCell className="tabular">
                <span dir="ltr">{h.dateFrom}</span>
              </TableCell>
              <TableCell className="tabular">
                <span dir="ltr">{h.dateTo}</span>
              </TableCell>
              {canManage && (
                <TableCell className="text-end whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => onEdit(h)}>
                    <Pencil aria-hidden />
                  </Button>
                  <ConfirmButton
                    size="icon-sm"
                    variant="ghost"
                    icon={<Trash2 aria-hidden />}
                    label={tu("delete")}
                    title={tu("confirmDelete")}
                    description={tu("confirmDeleteBody")}
                    onConfirm={() => remove.mutateAsync(h.id)}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HolidayDialog({
  holiday,
  branches,
  open,
  onOpenChange,
}: {
  holiday: Holiday | null;
  branches: Branch[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("hours");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const text = useText();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ branchId: "", name: {} as L, dateFrom: today, dateTo: today });
  useEffect(() => {
    if (open)
      setF(
        holiday
          ? { branchId: holiday.branchId ?? "", name: holiday.name, dateFrom: holiday.dateFrom, dateTo: holiday.dateTo }
          : { branchId: "", name: {}, dateFrom: today, dateTo: today },
      );
  }, [open, holiday, today]);
  const save = useApiMutation(
    () => {
      const body = { ...f, branchId: f.branchId || null };
      return holiday
        ? api(`/api/v1/admin/holidays/${holiday.id}`, { method: "PUT", body })
        : api("/api/v1/admin/holidays", { body });
    },
    { invalidate, success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{holiday ? t("editHoliday") : t("addHoliday")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <LocalizedInput id="h-name" label={tu("name")} value={f.name} onChange={(name) => setF({ ...f, name })} required />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tu("branch")} htmlFor="h-branch">
              <NativeSelect id="h-branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                <option value="">{tu("allBranches")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {text(b.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("from")} htmlFor="h-from">
              <Input
                id="h-from"
                type="date"
                dir="ltr"
                required
                value={f.dateFrom}
                onChange={(e) => setF({ ...f, dateFrom: e.target.value })}
              />
            </Field>
            <Field label={t("to")} htmlFor="h-to">
              <Input
                id="h-to"
                type="date"
                dir="ltr"
                required
                value={f.dateTo}
                onChange={(e) => setF({ ...f, dateTo: e.target.value })}
              />
            </Field>
          </div>
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
