"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import type { Shift } from "../../types";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";
import { ShiftsManager } from "../shifts-breaks";

export function AgentsSection({ initial, shifts }: { initial: SettingValue<"agentWork">; shifts: Shift[] }) {
  const t = useTranslations("settings");
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("agentsIntro")}</p>
      <SettingForm k="agentWork" initial={initial}>
        {(v, set) => (
          <>
            <SettingCard title={t("cards.workload")} columns={2}>
              <div className="sm:col-span-2">
                <Check
                  id="aw-multi"
                  label={t("multipleVisitors")}
                  hint={t("multipleVisitorsHint")}
                  checked={v.multipleVisitors}
                  onChange={(multipleVisitors) => set({ multipleVisitors })}
                />
              </div>
              <NumField
                id="aw-per"
                label={t("visitorsPerAgent")}
                hint={t("visitorsPerAgentHint")}
                value={v.visitorsPerAgent}
                min={1}
                max={20}
                disabled={!v.multipleVisitors}
                className="max-w-48"
                onChange={(visitorsPerAgent) => set({ visitorsPerAgent })}
              />
            </SettingCard>
            <SettingCard title={t("cards.shiftRules")}>
              <fieldset id="aw-shift" className="space-y-2">
                <legend className="text-sm font-semibold">{t("shiftMode")}</legend>
                <p className="text-muted-foreground text-xs">{t("shiftModeHint")}</p>
                <div className="space-y-1" role="radiogroup" aria-label={t("shiftMode")}>
                  {(["off", "guide", "strict"] as const).map((m) => (
                    <label key={m} className="flex min-h-8 items-start gap-2.5 py-1 text-sm">
                      <input
                        type="radio"
                        name="aw-shift-mode"
                        className="accent-brand focus-visible:ring-ring/50 mt-0.5 size-4 outline-none focus-visible:ring-3"
                        checked={v.shiftMode === m}
                        onChange={() => set({ shiftMode: m })}
                      />
                      <span>
                        {t(`shiftMode_${m}`)}
                        <span className="text-muted-foreground block text-xs">{t(`shiftMode_${m}_hint`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <NumField
                id="aw-grace"
                label={t("shiftEndGrace")}
                hint={t("shiftEndGraceHint")}
                value={v.shiftEndGraceMinutes}
                min={0}
                max={120}
                disabled={v.shiftMode !== "strict"}
                className="max-w-48"
                onChange={(shiftEndGraceMinutes) => set({ shiftEndGraceMinutes })}
              />
            </SettingCard>
          </>
        )}
      </SettingForm>
      <ShiftsManager items={shifts} />
    </div>
  );
}
