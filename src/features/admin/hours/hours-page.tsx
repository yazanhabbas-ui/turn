"use client";

import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ErrorState, LocalizedInput, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { L, Schedule, ScheduleRule } from "../types";
import { LOOKUPS, useText } from "../use-lookups";
import { useListJoin } from "../use-list";

const HOURS = "/api/v1/admin/schedules";
const invalidate = [[HOURS], [LOOKUPS]];
const WEEK = [0, 1, 2, 3, 4, 5, 6];
type Data = { schedules: Schedule[] };

export function HoursPage({ canManage }: { canManage: boolean }) {
  const t = useTranslations("hours");
  const data = useApiQuery<Data>(HOURS);
  const [schedule, setSchedule] = useState<Schedule | "new" | null>(null);

  if (data.isLoading) return <LoadingRows rows={6} />;
  if (data.isError || !data.data) return <ErrorState onRetry={() => data.refetch()} />;

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

      <ScheduleDialog
        schedule={schedule === "new" ? null : schedule}
        open={schedule !== null}
        onOpenChange={(o) => !o && setSchedule(null)}
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
