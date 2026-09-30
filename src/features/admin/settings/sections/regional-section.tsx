"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, DigitsSelect, Field } from "../setting-field";
import { SettingForm } from "../setting-form";

export function RegionalSection({ initial }: { initial: SettingValue<"regional"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="regional" initial={initial}>
      {(v, set) => (
        <>
          <SettingCard title={t("cards.digits")} columns={3}>
            <DigitsSelect
              id="rg-ds"
              label={t("digitsScreen")}
              value={v.digitsScreen}
              onChange={(digitsScreen) => set({ digitsScreen })}
            />
            <DigitsSelect
              id="rg-dt"
              label={t("digitsTicket")}
              value={v.digitsTicket}
              onChange={(digitsTicket) => set({ digitsTicket })}
            />
            <DigitsSelect
              id="rg-dv"
              label={t("digitsVoice")}
              value={v.digitsVoice}
              onChange={(digitsVoice) => set({ digitsVoice })}
            />
          </SettingCard>
          <SettingCard title={t("cards.timeAndPhone")} columns={2}>
            <Field label={t("timeFormat")} htmlFor="rg-tf">
              <NativeSelect
                id="rg-tf"
                value={v.timeFormat}
                onChange={(e) => set({ timeFormat: e.target.value as "12h" | "24h" })}
              >
                <option value="12h">{t("time12")}</option>
                <option value="24h">{t("time24")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("phoneCountryCode")} htmlFor="rg-cc" hint={t("phoneCountryCodeHint")}>
              <div className="flex max-w-48 items-center gap-1.5" dir="ltr">
                <span className="text-muted-foreground font-medium" aria-hidden>
                  +
                </span>
                <Input
                  id="rg-cc"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{1,4}"
                  required
                  value={v.phoneCountryCode}
                  onChange={(e) => set({ phoneCountryCode: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </div>
            </Field>
          </SettingCard>
          <SettingCard title={t("cards.calendar")}>
            <Check id="rg-hijri" label={t("showHijri")} checked={v.showHijri} onChange={(showHijri) => set({ showHijri })} />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
