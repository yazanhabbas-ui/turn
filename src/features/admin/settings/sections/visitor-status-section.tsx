"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check } from "../setting-field";
import { SettingForm } from "../setting-form";

export function VisitorStatusSection({ initial }: { initial: SettingValue<"visitorStatus"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="visitorStatus" initial={initial}>
      {(v, set) => (
        <SettingCard title={t("cards.visitorPage")} columns={2}>
          <div className="sm:col-span-2">
            <Check
              id="vs-enabled"
              label={t("visitorStatusEnabled")}
              checked={v.enabled}
              onChange={(enabled) => set({ enabled })}
            />
          </div>
        </SettingCard>
      )}
    </SettingForm>
  );
}
