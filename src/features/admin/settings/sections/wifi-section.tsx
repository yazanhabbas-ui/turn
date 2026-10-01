"use client";

import { useTranslations } from "next-intl";
import { Field as FormField, LocalizedInput } from "@/components/admin/form";
import { Input } from "@/components/ui/input";
import { pickText } from "@/i18n/locales";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check } from "../setting-field";
import { SettingForm } from "../setting-form";

/** Free Wi-Fi on the ticket. The level it applies to (organization, city or branch) is picked at the top of the page. */
export function WifiSection({ initial }: { initial: SettingValue<"wifi"> }) {
  const t = useTranslations("settings");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("wifiIntro")}</p>
      <SettingForm k="wifi" initial={initial}>
        {(v, set) => (
          <>
            <SettingCard title={t("cards.wifiNetwork")} columns={2}>
              <div className="sm:col-span-2">
                <Check
                  id="wf-enabled"
                  label={t("wifiEnabled")}
                  hint={t("wifiEnabledHint")}
                  checked={v.enabled}
                  onChange={(enabled) => set({ enabled })}
                />
              </div>
              <FormField label={t("wifiSsid")} htmlFor="wf-ssid">
                <Input id="wf-ssid" dir="ltr" maxLength={32} value={v.ssid} onChange={(e) => set({ ssid: e.target.value })} />
              </FormField>
              <FormField label={t("wifiPassword")} htmlFor="wf-pass" hint={t("wifiPasswordHint")}>
                <Input
                  id="wf-pass"
                  dir="ltr"
                  maxLength={63}
                  autoComplete="off"
                  value={v.password}
                  onChange={(e) => set({ password: e.target.value })}
                />
              </FormField>
              <div className="sm:col-span-2">
                <Check
                  id="wf-qr"
                  label={t("wifiShowQr")}
                  hint={t("wifiShowQrHint")}
                  checked={v.showQr}
                  onChange={(showQr) => set({ showQr })}
                />
              </div>
            </SettingCard>
            <SettingCard title={t("cards.wifiTexts")} columns={2}>
              <div className="sm:col-span-2">
                <LocalizedInput id="wf-title" label={t("wifiTitle")} value={v.title} onChange={(title) => set({ title })} />
              </div>
              <LocalizedInput
                id="wf-ssid-label"
                label={t("wifiSsidLabel")}
                value={v.ssidLabel}
                onChange={(ssidLabel) => set({ ssidLabel })}
              />
              <LocalizedInput
                id="wf-pass-label"
                label={t("wifiPasswordLabel")}
                value={v.passwordLabel}
                onChange={(passwordLabel) => set({ passwordLabel })}
              />
            </SettingCard>
            {v.enabled && v.ssid && (
              <div className="bg-muted/40 rounded-lg border border-dashed p-3 text-center text-sm">
                <div className="font-semibold">{pickText(v.title, "ar") || pickText(v.title, "en")}</div>
                <div>
                  {pickText(v.ssidLabel, "ar")}: <bdi className="font-mono font-bold">{v.ssid}</bdi>
                </div>
                {v.password && (
                  <div>
                    {pickText(v.passwordLabel, "ar")}: <bdi className="font-mono font-bold">{v.password}</bdi>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </SettingForm>
    </div>
  );
}
