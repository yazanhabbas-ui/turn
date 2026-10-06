"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check } from "../setting-field";
import { SettingForm } from "../setting-form";

/** Shows or hides the Help center (the user manuals) for everyone. */
export function HelpCenterSection({ initial }: { initial: SettingValue<"helpCenter"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="helpCenter" initial={initial}>
      {(v, set) => (
        <SettingCard title={t("cards.helpCenter")} description={t("helpCenterIntro")}>
          <Check
            id="hc-enabled"
            label={t("helpCenterEnabled")}
            hint={t("helpCenterEnabledHint")}
            checked={v.enabled}
            onChange={(enabled) => set({ enabled })}
          />
        </SettingCard>
      )}
    </SettingForm>
  );
}
