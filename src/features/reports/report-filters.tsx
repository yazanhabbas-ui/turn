"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { AgentPicker, type PickerOption } from "@/components/admin/agent-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import {
  addDays,
  daysBetween,
  MAX_DAYS,
  PRESETS,
  presetRange,
  todayIn,
  type Preset,
  type ReportFilterState,
  type ReportMeta,
} from "./filters";
import { useReportFormat } from "./use-report-format";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function ReportFilters({
  filters,
  meta,
  timeZone,
  onChange,
}: {
  filters: ReportFilterState;
  meta: ReportMeta | undefined;
  timeZone: string;
  onChange: (patch: Partial<ReportFilterState>) => void;
}) {
  const t = useTranslations("reports.filters");
  const locale = useLocale();
  const f = useReportFormat();
  const today = todayIn(timeZone);
  const agentOptions = useMemo<PickerOption[]>(
    () =>
      (meta?.agents ?? []).map((a) => ({
        id: a.id,
        label: pickText(a.name, locale),
        altLabels: Object.values(a.name ?? {}).filter(Boolean),
      })),
    [meta?.agents, locale],
  );

  function setFrom(from: string) {
    if (!from) return;
    let to = filters.to;
    if (to < from) to = from;
    if (daysBetween(from, to) + 1 > MAX_DAYS) to = addDays(from, MAX_DAYS - 1);
    onChange({ from, to });
  }
  function setTo(to: string) {
    if (!to) return;
    let from = filters.from;
    if (from > to) from = to;
    if (daysBetween(from, to) + 1 > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
    onChange({ from, to });
  }
  function toggleWeekday(d: number) {
    const has = filters.weekdays.includes(d);
    onChange({ weekdays: has ? filters.weekdays.filter((x) => x !== d) : [...filters.weekdays, d] });
  }
  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === filters.from && r.to === filters.to;
  });
  const dirty =
    !!filters.branchId ||
    !!filters.reasonId ||
    !!filters.agentId ||
    filters.weekdays.length > 0 ||
    filters.hourFrom !== null ||
    filters.hourTo !== null;

  return (
    <div className="bg-background/95 no-print sticky top-14 z-20 -mx-4 mb-4 space-y-3 border-b px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground block">{t("from")}</span>
            <Input type="date" className="w-40" value={filters.from} max={filters.to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground block">{t("to")}</span>
            <Input type="date" className="w-40" value={filters.to} min={filters.from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("presets")}>
          {PRESETS.map((p: Preset) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={activePreset === p ? "default" : "outline"}
              aria-pressed={activePreset === p}
              onClick={() => onChange(presetRange(p, today))}
            >
              {t(`preset.${p}`)}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground pb-2 text-xs">{t("maxRange", { n: f.num(MAX_DAYS) })}</span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {meta && meta.branches.length > 1 && (
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground block">{t("branch")}</span>
            <NativeSelect className="w-44" value={filters.branchId} onChange={(e) => onChange({ branchId: e.target.value })}>
              <option value="">{t("allBranches")}</option>
              {meta.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {pickText(b.name, locale)}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground block">{t("reason")}</span>
          <NativeSelect className="w-44" value={filters.reasonId} onChange={(e) => onChange({ reasonId: e.target.value })}>
            <option value="">{t("allReasons")}</option>
            {meta?.reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {pickText(r.name, locale)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="space-y-1 text-xs font-medium">
          <label htmlFor="rf-agent" className="text-muted-foreground block">
            {t("agent")}
          </label>
          <AgentPicker
            id="rf-agent"
            className="w-44"
            options={agentOptions}
            value={filters.agentId}
            onChange={(agentId) => onChange({ agentId })}
            placeholder={t("allAgents")}
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground block">{t("hourFrom")}</span>
            <NativeSelect
              className="w-20"
              value={filters.hourFrom ?? ""}
              onChange={(e) => onChange({ hourFrom: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">–</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {f.hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground block">{t("hourTo")}</span>
            <NativeSelect
              className="w-20"
              value={filters.hourTo ?? ""}
              onChange={(e) => onChange({ hourTo: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">–</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {f.hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="space-y-1">
          <span className="text-muted-foreground block text-xs font-medium">{t("weekdays")}</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("weekdays")}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = filters.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWeekday(d)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-medium transition",
                    on ? "bg-brand border-transparent text-white" : "bg-background hover:bg-muted",
                  )}
                >
                  {f.weekdayName(d)}
                </button>
              );
            })}
          </div>
        </div>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ branchId: "", reasonId: "", agentId: "", weekdays: [], hourFrom: null, hourTo: null })}
          >
            {t("clear")}
          </Button>
        )}
      </div>
    </div>
  );
}
