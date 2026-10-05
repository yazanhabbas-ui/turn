"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

/** How many agents of a branch may be on a break at once, and how long the next in line has to take a freed place. */
export function BreakLimitSection({ initial }: { initial: SettingValue<"breaks"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="breaks" initial={initial}>
      {(v, set) => {
        const setMax = (patch: Partial<typeof v.maxOnBreak>) => set({ maxOnBreak: { ...v.maxOnBreak, ...patch } });
        const example = 3;
        const max =
          v.maxOnBreak.mode === "count" ? v.maxOnBreak.value : Math.max(1, Math.floor((example * v.maxOnBreak.value) / 100));
        return (
          <>
            <SettingCard title={t("cards.breakLimit")} description={t("breakLimitIntro")}>
              <Check
                id="bl-enabled"
                label={t("breakLimitEnabled")}
                hint={t("breakLimitEnabledHint")}
                checked={v.enabled}
                onChange={(enabled) => set({ enabled })}
              />
              <fieldset id="bl-max" className="space-y-2" disabled={!v.enabled}>
                <legend className="mb-1.5 text-sm font-medium">{t("maxOnBreak")}</legend>
                <div className="grid max-w-md gap-3 sm:grid-cols-2">
                  <Input
                    aria-label={t("maxOnBreak")}
                    type="number"
                    min={1}
                    max={100}
                    value={v.maxOnBreak.value}
                    onChange={(e) => setMax({ value: Number(e.target.value) })}
                  />
                  <NativeSelect
                    aria-label={t("maxOnBreakMode")}
                    value={v.maxOnBreak.mode}
                    onChange={(e) => setMax({ mode: e.target.value as "count" | "percent" })}
                  >
                    <option value="count">{t("maxOnBreakCount")}</option>
                    <option value="percent">{t("maxOnBreakPercent")}</option>
                  </NativeSelect>
                </div>
                <p className="text-muted-foreground text-xs" aria-live="polite">
                  {t("maxOnBreakPreview", { agents: example, max })}
                </p>
              </fieldset>
              <NumField
                id="bl-hold"
                label={t("holdMinutes")}
                hint={t("holdMinutesHint")}
                value={v.holdMinutes}
                min={1}
                max={30}
                disabled={!v.enabled}
                className="max-w-48"
                onChange={(holdMinutes) => set({ holdMinutes })}
              />
            </SettingCard>
            <p className="bg-muted/40 rounded-lg border border-dashed p-3 text-sm">{t("breakLimitExplainer")}</p>
          </>
        );
      }}
    </SettingForm>
  );
}
