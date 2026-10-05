"use client";

import { Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { EmptyState, ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Check } from "@/features/admin/screens/check";
import { EXPORT_SECTIONS, type ExportSectionId } from "@/domain/reports/sections";
import { pickText } from "@/i18n/locales";

const SCHEDULES = "/api/v1/reports/schedules";
const MAX_RECIPIENTS = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type L = Record<string, string>;
type Schedule = {
  id: string;
  name: string;
  frequency: "daily" | "weekly";
  weekday: number | null;
  sendHour: number;
  format: "pdf" | "xlsx" | "csv";
  locale: "ar" | "en";
  branchId: string | null;
  reasonId: string | null;
  recipients: string[];
  /** null = every section. */
  sections: ExportSectionId[] | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};
type Options = { orgWide: boolean; branches: { id: string; name: L }[]; reasons: { id: string; name: L }[] };
type Payload = { items: Schedule[]; options: Options };
type DeliveryResult = { sent: number; failed: number; skipped: number };

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

type Form = {
  name: string;
  frequency: "daily" | "weekly";
  weekday: number;
  sendHour: number;
  format: Schedule["format"];
  locale: Schedule["locale"];
  branchId: string;
  reasonId: string;
  recipients: string;
  sections: ExportSectionId[];
  isActive: boolean;
};

function toForm(s: Schedule | null, options: Options): Form {
  return {
    name: s?.name ?? "",
    frequency: s?.frequency ?? "daily",
    weekday: s?.weekday ?? 0,
    sendHour: s?.sendHour ?? 7,
    format: s?.format ?? "pdf",
    locale: s?.locale ?? "ar",
    // Without an organization-wide grant a schedule must name one of the caller's branches.
    branchId: s ? (s.branchId ?? "") : options.orgWide ? "" : (options.branches[0]?.id ?? ""),
    reasonId: s?.reasonId ?? "",
    recipients: (s?.recipients ?? []).join("\n"),
    sections: s?.sections ?? [...EXPORT_SECTIONS],
    isActive: s?.isActive ?? true,
  };
}

const parseRecipients = (raw: string) => [
  ...new Set(
    raw
      .split(/[\s,;،]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  ),
];

export function SchedulesPanel() {
  const t = useTranslations("reportSchedules");
  const tu = useTranslations("ui");
  const tw = useTranslations("reportExport.weekdays");
  const locale = useLocale();
  const format = useFormatter();
  const list = useApiQuery<Payload>(SCHEDULES);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const remove = useApiMutation((id: string) => api(`${SCHEDULES}/${id}`, { method: "DELETE" }), {
    invalidate: [[SCHEDULES]],
    success: tu("saved"),
  });
  const sendNow = useApiMutation((id: string) => api<DeliveryResult>(`${SCHEDULES}/${id}/send`, { method: "POST" }), {
    invalidate: [[SCHEDULES]],
    onSuccess: (r) => {
      const total = r.sent + r.failed + r.skipped;
      if (r.sent > 0) toast.success(t("sentNow", { sent: r.sent, total }));
      else toast.error(t("sentNone"));
    },
  });

  if (list.isLoading) return <LoadingRows rows={2} />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;
  const { items, options } = list.data;
  const branchName = (id: string | null) =>
    id ? pickText(options.branches.find((b) => b.id === id)?.name, locale, "—") : tu("allBranches");
  const when = (s: Schedule) =>
    s.frequency === "weekly"
      ? t("summaryWeekly", { day: tw(String(s.weekday ?? 0)), time: hourLabel(s.sendHour) })
      : t("summaryDaily", { time: hourLabel(s.sendHour) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InfoTip>{t("intro")}</InfoTip>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        items.map((s) => (
          <div key={s.id} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
              <Mail className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span className="truncate">{s.name}</span>
                <Badge variant="secondary">{t(`formats.${s.format}`)}</Badge>
                {s.sections && <Badge variant="outline">{t("sectionsCount", { count: s.sections.length })}</Badge>}
                <Badge variant={s.isActive ? "default" : "outline"}>{s.isActive ? tu("active") : tu("inactive")}</Badge>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {when(s)} · {branchName(s.branchId)} · {t("recipientsCount", { count: s.recipients.length })}
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                {s.lastRunAt
                  ? t("lastRun", { at: format.dateTime(new Date(s.lastRunAt), { dateStyle: "medium", timeStyle: "short" }) })
                  : t("neverRun")}
              </div>
              {s.lastError && <div className="text-destructive mt-0.5 text-xs">{t("lastError")}</div>}
            </div>
            <Button variant="outline" size="sm" disabled={sendNow.isPending} onClick={() => sendNow.mutate(s.id)}>
              <Send aria-hidden />
              {t("sendNow")}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={tu("edit")} onClick={() => setEditing(s)}>
              <Pencil aria-hidden />
            </Button>
            <ConfirmButton
              size="icon-sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              label={tu("delete")}
              title={tu("confirmDelete")}
              description={tu("confirmDeleteBody")}
              onConfirm={() => remove.mutateAsync(s.id)}
            />
          </div>
        ))
      )}
      <ScheduleDialog
        options={options}
        item={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}

function ScheduleDialog({
  options,
  item,
  open,
  onOpenChange,
}: {
  options: Options;
  item: Schedule | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("reportSchedules");
  const tu = useTranslations("ui");
  const tc = useTranslations("common");
  const tw = useTranslations("reportExport.weekdays");
  const tsec = useTranslations("reportExport.sections");
  const locale = useLocale();
  const [f, setF] = useState<Form>(() => toForm(null, options));
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) {
      setF(toForm(item, options));
      setShowErrors(false);
    }
  }, [open, item, options]);

  const recipients = parseRecipients(f.recipients);
  const invalid = recipients.filter((r) => !EMAIL.test(r));
  const recipientsError = !recipients.length
    ? t("recipientsRequired")
    : invalid.length
      ? t("recipientsInvalid", { list: invalid.slice(0, 3).join(", ") })
      : recipients.length > MAX_RECIPIENTS
        ? t("recipientsTooMany", { max: MAX_RECIPIENTS })
        : null;

  const save = useApiMutation(
    () => {
      const body = {
        name: f.name.trim(),
        frequency: f.frequency,
        weekday: f.frequency === "weekly" ? f.weekday : null,
        sendHour: f.sendHour,
        format: f.format,
        locale: f.locale,
        branchId: f.branchId || null,
        reasonId: f.reasonId || null,
        recipients,
        sections: f.sections.length === EXPORT_SECTIONS.length ? null : f.sections,
        isActive: f.isActive,
      };
      return item ? api(`${SCHEDULES}/${item.id}`, { method: "PUT", body }) : api(SCHEDULES, { body });
    },
    { invalidate: [[SCHEDULES]], success: tu("saved"), onSuccess: () => onOpenChange(false) },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? t("edit") : t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setShowErrors(true);
            if (recipientsError || !f.name.trim() || f.sections.length === 0) return;
            save.mutate(undefined);
          }}
        >
          <Field label={t("name")} htmlFor="rs-name" error={showErrors && !f.name.trim() ? t("nameRequired") : null}>
            <Input id="rs-name" value={f.name} maxLength={80} required onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("frequency")} htmlFor="rs-freq">
              <NativeSelect
                id="rs-freq"
                value={f.frequency}
                onChange={(e) => setF({ ...f, frequency: e.target.value as Form["frequency"] })}
              >
                <option value="daily">{t("daily")}</option>
                <option value="weekly">{t("weekly")}</option>
              </NativeSelect>
            </Field>
            {f.frequency === "weekly" ? (
              <Field label={t("weekday")} htmlFor="rs-day">
                <NativeSelect id="rs-day" value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {tw(String(d))}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Field label={t("sendHour")} htmlFor="rs-hour" hint={t(f.frequency === "weekly" ? "periodWeekly" : "periodDaily")}>
              <NativeSelect id="rs-hour" value={f.sendHour} onChange={(e) => setF({ ...f, sendHour: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("format")} htmlFor="rs-format">
              <NativeSelect
                id="rs-format"
                value={f.format}
                onChange={(e) => setF({ ...f, format: e.target.value as Form["format"] })}
              >
                <option value="pdf">{t("formats.pdf")}</option>
                <option value="xlsx">{t("formats.xlsx")}</option>
                <option value="csv">{t("formats.csv")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("language")} htmlFor="rs-lang">
              <NativeSelect
                id="rs-lang"
                value={f.locale}
                onChange={(e) => setF({ ...f, locale: e.target.value as Form["locale"] })}
              >
                <option value="ar">{tu("languageAr")}</option>
                <option value="en">{tu("languageEn")}</option>
              </NativeSelect>
            </Field>
            <Field label={tu("branch")} htmlFor="rs-branch" hint={options.orgWide ? undefined : t("branchScoped")}>
              <NativeSelect id="rs-branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
                {options.orgWide && <option value="">{tu("allBranches")}</option>}
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {pickText(b.name, locale, "—")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("reason")} htmlFor="rs-reason" className="sm:col-span-2">
              <NativeSelect id="rs-reason" value={f.reasonId} onChange={(e) => setF({ ...f, reasonId: e.target.value })}>
                <option value="">{t("allReasons")}</option>
                {options.reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {pickText(r.name, locale, "—")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field
            label={t("recipients")}
            htmlFor="rs-recipients"
            hint={t("recipientsHint", { max: MAX_RECIPIENTS })}
            error={showErrors ? recipientsError : null}
          >
            <Textarea
              id="rs-recipients"
              dir="ltr"
              rows={4}
              placeholder="name@example.com"
              value={f.recipients}
              onChange={(e) => setF({ ...f, recipients: e.target.value })}
            />
          </Field>
          <Field
            label={t("sections")}
            hint={t("sectionsHint")}
            error={showErrors && f.sections.length === 0 ? t("sectionsRequired") : null}
          >
            <div className="space-y-2">
              <div className="flex gap-1">
                <Button type="button" size="xs" variant="ghost" onClick={() => setF({ ...f, sections: [...EXPORT_SECTIONS] })}>
                  {t("exportMenu.selectAll")}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setF({ ...f, sections: [] })}>
                  {t("exportMenu.selectNone")}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXPORT_SECTIONS.map((id) => (
                  <Check
                    key={id}
                    label={tsec(id)}
                    checked={f.sections.includes(id)}
                    onChange={(on) =>
                      setF({ ...f, sections: EXPORT_SECTIONS.filter((x) => (x === id ? on : f.sections.includes(x))) })
                    }
                  />
                ))}
              </div>
            </div>
          </Field>
          <Check label={tu("active")} checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
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
