"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

export function ReportsSection({ initial }: { initial: SettingValue<"reports"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="reports" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("reportsIntro")}</p>
          <SettingCard title={t("cards.serviceLevel")} columns={2}>
            <NumField
              id="rp-slm"
              label={t("serviceLevelMinutes")}
              hint={t("serviceLevelMinutesHint")}
              value={v.serviceLevelMinutes}
              min={1}
              max={120}
              onChange={(serviceLevelMinutes) => set({ serviceLevelMinutes })}
            />
            <NumField
              id="rp-slp"
              label={t("serviceLevelTargetPct")}
              hint={t("serviceLevelTargetPctHint")}
              value={v.serviceLevelTargetPct}
              min={1}
              max={100}
              onChange={(serviceLevelTargetPct) => set({ serviceLevelTargetPct })}
            />
          </SettingCard>
          <SettingCard title={t("cards.capacity")} columns={2}>
            <NumField
              id="rp-util"
              label={t("targetUtilisationPct")}
              hint={t("targetUtilisationPctHint")}
              value={v.targetUtilisationPct}
              min={30}
              max={100}
              onChange={(targetUtilisationPct) => set({ targetUtilisationPct })}
            />
            <NumField
              id="rp-hist"
              label={t("forecastHistoryDays")}
              hint={t("forecastHistoryDaysHint")}
              value={v.forecastHistoryDays}
              min={7}
              max={90}
              onChange={(forecastHistoryDays) => set({ forecastHistoryDays })}
            />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
