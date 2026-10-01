"use client";

import { useTranslations } from "next-intl";
import { LocalizedInput } from "@/components/admin/form";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check } from "../setting-field";
import { SettingForm } from "../setting-form";

export function PrivacySection({ initial }: { initial: SettingValue<"privacy"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="privacy" initial={initial}>
      {(v, set) => (
        <>
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
