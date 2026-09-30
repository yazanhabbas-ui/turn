"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ErrorState, Field, LoadingRows, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { estimateWait, waitValueText } from "@/domain/distribution/estimate";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { SettingValue } from "@/server/settings/registry";
import type { L } from "../types";
import { useText } from "../use-lookups";

type WaitSettings = SettingValue<"waitEstimate">;
type Stats = {
  lookbackDays: number;
  minSamples: number;
  reasons: {
    reasonId: string;
    name: L;
    samples: number;
    average: number | null;
    median: number | null;
    p25: number | null;
    p75: number | null;
    expectedMinutes: number;
    usedMinutes: number;
    source: "fixed" | "reason" | "analytics" | "learning";
  }[];
};

const SETTINGS = "/api/v1/admin/settings";
const MODES = ["fixed", "reason", "analytics"] as const;
const PREVIEW_POSITIONS = [1, 3, 6, 10];

const fmt = (n: number | null, digits = 1) => (n === null ? "—" : String(Math.round(n * 10 ** digits) / 10 ** digits));

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
      </span>
    </label>
  );
}

function Num({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/**
 * Waiting time shown to visitors: how long one visitor takes (fixed, per reason, or learned from real data), how it
 * is rounded, and how it is worded on the ticket. An organization default plus an own value per branch.
 */
export function WaitEstimateTab({
  defaults,
  branches,
  organization,
}: {
  defaults: WaitSettings;
  branches: { id: string; name: L }[];
  organization: boolean;
}) {
  const t = useTranslations("settings");
  const text = useText();
  const [branchId, setBranchId] = useState(organization ? "" : (branches[0]?.id ?? ""));
  const scoped = useApiQuery<{ waitEstimate: WaitSettings }>(branchId ? `${SETTINGS}?branchId=${branchId}` : null);
  const clear = useApiMutation(() => api(`${SETTINGS}/waitEstimate?branchId=${branchId}`, { method: "DELETE" }), {
    invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`], ["/api/v1/admin/wait-analytics"]],
    success: t("weInherited"),
  });
  const value = branchId ? scoped.data?.waitEstimate : defaults;

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-muted-foreground text-sm">{t("weIntro")}</p>
      {branches.length > 0 && (
        <Field label={t("wifiScope")} htmlFor="we-scope" className="max-w-sm">
          <NativeSelect id="we-scope" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {organization && <option value="">{t("wifiAllBranches")}</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {text(b.name)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {value ? <WaitForm key={branchId} initial={value} branchId={branchId || null} /> : <LoadingRows rows={4} />}
      {branchId && (
        <Button variant="outline" size="sm" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
          {t("wifiUseDefault")}
        </Button>
      )}
    </div>
  );
}

function WaitForm({ initial, branchId }: { initial: WaitSettings; branchId: string | null }) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  const set = (patch: Partial<WaitSettings>) => setV((d) => ({ ...d, ...patch }));
  const save = useApiMutation(
    () => api(`${SETTINGS}/waitEstimate${branchId ? `?branchId=${branchId}` : ""}`, { method: "PUT", body: v }),
    {
      invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`], ["/api/v1/admin/wait-analytics"]],
      success: t("saved"),
    },
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="bg-card space-y-4 rounded-xl border p-4 shadow-sm md:p-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("weMode")}</legend>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={t("weMode")}>
            {MODES.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                  v.mode === m ? "border-brand bg-brand/5" : "hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="we-mode"
                  className="accent-brand mt-0.5 size-4"
                  checked={v.mode === m}
                  onChange={() => set({ mode: m })}
                />
                <span>
                  <span className="font-medium">{t(`weMode_${m}`)}</span>
                  <span className="text-muted-foreground block text-xs">{t(`weMode_${m}_hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {v.mode === "fixed" && (
          <Num
            id="we-fixed"
            label={t("weFixedMinutes")}
            hint={t("weFixedMinutesHint")}
            value={v.fixedMinutesPerVisitor}
            min={0.5}
            max={120}
            step={0.5}
            onChange={(fixedMinutesPerVisitor) => set({ fixedMinutesPerVisitor })}
          />
        )}
        <Check
          label={t("weDivideByAgents")}
          hint={t("weDivideByAgentsHint")}
          checked={v.divideByAgents}
          onChange={(divideByAgents) => set({ divideByAgents })}
        />

        {v.mode === "analytics" && (
          <fieldset className="space-y-3 border-t pt-4">
            <legend className="text-sm font-semibold">{t("weAnalytics")}</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Num
                id="we-days"
                label={t("weLookbackDays")}
                hint={t("weLookbackDaysHint")}
                value={v.lookbackDays}
                min={1}
                max={90}
                onChange={(lookbackDays) => set({ lookbackDays })}
              />
              <Num
                id="we-min"
                label={t("weMinSamples")}
                hint={t("weMinSamplesHint")}
                value={v.minSamples}
                min={1}
                max={1000}
                onChange={(minSamples) => set({ minSamples })}
              />
              <Field label={t("weStatistic")} htmlFor="we-stat" hint={t(`weStatistic_${v.statistic}_hint`)}>
                <NativeSelect
                  id="we-stat"
                  value={v.statistic}
                  onChange={(e) => set({ statistic: e.target.value as WaitSettings["statistic"] })}
                >
                  <option value="median">{t("weStatistic_median")}</option>
                  <option value="average">{t("weStatistic_average")}</option>
                  <option value="p75">{t("weStatistic_p75")}</option>
                </NativeSelect>
              </Field>
            </div>
            <Check
              label={t("weWeightByHour")}
              hint={t("weWeightByHourHint")}
              checked={v.weightByHour}
              onChange={(weightByHour) => set({ weightByHour })}
            />
            <Check
              label={t("weTrimOutliers")}
              hint={t("weTrimOutliersHint")}
              checked={v.trimOutliers}
              onChange={(trimOutliers) => set({ trimOutliers })}
            />
          </fieldset>
        )}

        <fieldset className="space-y-3 border-t pt-4">
          <legend className="text-sm font-semibold">{t("weDisplay")}</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("weRounding")} htmlFor="we-round" hint={t("weRoundingHint")}>
              <NativeSelect
                id="we-round"
                value={v.rounding}
                onChange={(e) => set({ rounding: Number(e.target.value) as WaitSettings["rounding"] })}
              >
                <option value={1}>{t("weRoundingN", { n: 1 })}</option>
                <option value={5}>{t("weRoundingN", { n: 5 })}</option>
                <option value={10}>{t("weRoundingN", { n: 10 })}</option>
              </NativeSelect>
            </Field>
            <Num
              id="we-buffer"
              label={t("weBuffer")}
              hint={t("weBufferHint")}
              value={v.bufferPercent}
              min={0}
              max={100}
              onChange={(bufferPercent) => set({ bufferPercent })}
            />
            <Num
              id="we-minshown"
              label={t("weMinShown")}
              hint={t("weMinShownHint")}
              value={v.minShown}
              min={0}
              max={60}
              onChange={(minShown) => set({ minShown })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Check
              label={t("weShowOnTicket")}
              hint={t("weShowOnTicketHint")}
              checked={v.showOnTicket}
              onChange={(showOnTicket) => set({ showOnTicket })}
            />
            <Check
              label={t("weShowAsRange")}
              hint={t("weShowAsRangeHint")}
              checked={v.showAsRange}
              onChange={(showAsRange) => set({ showAsRange })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <LocalizedInput id="we-label" label={t("weLabel")} value={v.label} onChange={(label) => set({ label })} />
            <LocalizedInput id="we-unit" label={t("weUnit")} value={v.unitLabel} onChange={(unitLabel) => set({ unitLabel })} />
            <LocalizedInput id="we-next" label={t("weNextText")} value={v.nextText} onChange={(nextText) => set({ nextText })} />
            <LocalizedInput
              id="we-disc"
              label={t("weDisclaimer")}
              value={v.disclaimer}
              onChange={(disclaimer) => set({ disclaimer })}
            />
          </div>
        </fieldset>

        <div className="flex justify-end border-t pt-4">
          <Button type="submit" disabled={save.isPending}>
            {tu("save")}
          </Button>
        </div>
      </div>

      <Preview v={v} branchId={branchId} />
    </form>
  );
}

/** Real durations per reason (needed for the analytics table and for the preview of the other modes). */
function Preview({ v, branchId }: { v: WaitSettings; branchId: string | null }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const text = useText();
  const stats = useApiQuery<Stats>(`/api/v1/admin/wait-analytics${branchId ? `?branchId=${branchId}` : ""}`);
  const [reasonId, setReasonId] = useState("");
  const [agents, setAgents] = useState(2);
  const rows = stats.data?.reasons ?? [];
  const row = rows.find((r) => r.reasonId === reasonId) ?? rows[0];

  /** Minutes per visitor for a reason under the draft (the table figures stand in for the raw samples). */
  const perVisitor = (r: (typeof rows)[number]) => {
    if (v.mode === "fixed") return { minutes: v.fixedMinutesPerVisitor };
    if (v.mode === "analytics" && r.samples >= v.minSamples && r.median !== null) {
      const minutes =
        v.statistic === "average" ? (r.average ?? r.median) : v.statistic === "p75" ? (r.p75 ?? r.median) : r.median;
      return { minutes, low: Math.min(minutes, r.p25 ?? minutes), high: Math.max(minutes, r.p75 ?? minutes) };
    }
    return { minutes: r.expectedMinutes, low: r.expectedMinutes * 0.75, high: r.expectedMinutes * 1.25 };
  };

  const previewRows = useMemo(() => {
    const base = row ? perVisitor(row) : { minutes: v.fixedMinutesPerVisitor };
    return PREVIEW_POSITIONS.map((ahead) => {
      const e = estimateWait(ahead, agents, base, v);
      const shown = waitValueText(e, v, (l) => pickText(l, locale));
      return { ahead, ...shown };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, row, agents, locale]);

  return (
    <div className="space-y-4">
      <section className="bg-card space-y-3 rounded-xl border p-4 shadow-sm md:p-6">
        <h3 className="text-sm font-semibold">{t("wePreview")}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {v.mode !== "fixed" && rows.length > 0 && (
            <Field label={t("wePreviewReason")} htmlFor="we-pv-reason">
              <NativeSelect id="we-pv-reason" value={row?.reasonId ?? ""} onChange={(e) => setReasonId(e.target.value)}>
                {rows.map((r) => (
                  <option key={r.reasonId} value={r.reasonId}>
                    {text(r.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Num
            id="we-pv-agents"
            label={t("wePreviewAgents")}
            value={agents}
            min={1}
            max={50}
            onChange={(n) => setAgents(Math.max(1, n || 1))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
          {previewRows.map((p) => (
            <div key={p.ahead} className="bg-muted/40 rounded-lg border p-3 text-center">
              <div className="text-muted-foreground text-xs">{t("wePreviewAhead", { n: p.ahead })}</div>
              <div className="mt-1 text-lg font-semibold">
                <bdi>{p.text}</bdi>
              </div>
            </div>
          ))}
        </div>
        {v.showOnTicket ? (
          <p className="text-muted-foreground text-xs">
            {pickText(v.label, locale)}
            {pickText(v.disclaimer, locale) ? ` · ${pickText(v.disclaimer, locale)}` : ""}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{t("weHiddenOnTicket")}</p>
        )}
      </section>

      {v.mode === "analytics" && (
        <section className="bg-card space-y-3 rounded-xl border p-4 shadow-sm md:p-6">
          <h3 className="text-sm font-semibold">{t("weTable")}</h3>
          <p className="text-muted-foreground text-xs">{t("weTableHint", { days: v.lookbackDays })}</p>
          {stats.isLoading ? (
            <LoadingRows rows={3} />
          ) : stats.isError ? (
            <ErrorState onRetry={() => stats.refetch()} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("weColReason")}</TableHead>
                    <TableHead>{t("weColSamples")}</TableHead>
                    <TableHead>{t("weColMedian")}</TableHead>
                    <TableHead>{t("weColAverage")}</TableHead>
                    <TableHead>{t("weColP75")}</TableHead>
                    <TableHead>{t("weColExpected")}</TableHead>
                    <TableHead>{t("weColUsed")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const learning = r.samples < v.minSamples;
                    const used = perVisitor(r).minutes;
                    return (
                      <TableRow key={r.reasonId}>
                        <TableCell className="font-medium">{text(r.name)}</TableCell>
                        <TableCell className="tabular">{r.samples}</TableCell>
                        <TableCell className="tabular">{fmt(r.median)}</TableCell>
                        <TableCell className="tabular">{fmt(r.average)}</TableCell>
                        <TableCell className="tabular">{fmt(r.p75)}</TableCell>
                        <TableCell className="tabular">{r.expectedMinutes}</TableCell>
                        <TableCell>
                          <span className="tabular font-semibold">{fmt(used)}</span>{" "}
                          {learning ? (
                            <Badge variant="secondary">{t("weLearning", { n: r.samples, min: v.minSamples })}</Badge>
                          ) : (
                            <Badge>{t("weLearned")}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
