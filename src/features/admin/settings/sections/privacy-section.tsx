"use client";

import { useTranslations } from "next-intl";
import { LocalizedInput } from "@/components/admin/form";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

export function PrivacySection({ initial }: { initial: SettingValue<"privacy"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="privacy" initial={initial}>
      {(v, set) => (
        <>
          <SettingCard title={t("cards.retention")}>
            <NumField
              id="pv-ret"
              label={t("retentionDays")}
              hint={t("retentionHint")}
              value={v.retentionDays}
              min={0}
              max={3650}
              className="max-w-60"
              onChange={(retentionDays) => set({ retentionDays })}
            />
          </SettingCard>
          <SettingCard title={t("cards.consent")}>
            <Check
              id="pv-require"
              label={t("requireConsent")}
              checked={v.requireConsent}
              onChange={(requireConsent) => set({ requireConsent })}
            />
            <LocalizedInput
              id="pv-consent"
              label={t("consentText")}
              multiline
              value={v.consentText}
              onChange={(consentText) => set({ consentText })}
            />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
