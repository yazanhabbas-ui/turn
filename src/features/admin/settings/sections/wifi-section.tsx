"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field as FormField, LoadingRows, LocalizedInput } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import type { SettingValue } from "@/server/settings/registry";
import type { L } from "../../types";
import { useText } from "../../use-lookups";
import { useSettingsShell } from "../settings-context";
import { SettingCard } from "../setting-card";
import { Check } from "../setting-field";
import { SETTINGS, SettingForm } from "../setting-form";
import type { AllSettings } from "./types";

/** Free Wi-Fi on the ticket: an organization default, plus an own value per branch (e.g. per city office). */
export function WifiSection({
  defaults,
  branches,
  organization,
}: {
  defaults: SettingValue<"wifi">;
  branches: { id: string; name: L }[];
  organization: boolean;
}) {
  const t = useTranslations("settings");
  const text = useText();
  const shell = useSettingsShell();
  // Without organization rights there is no "all branches" choice: start on the first branch you manage.
  const [branchId, setBranchId] = useState(organization ? "" : (branches[0]?.id ?? ""));
  const scoped = useApiQuery<AllSettings>(branchId ? `${SETTINGS}?branchId=${branchId}` : null);
  const clear = useApiMutation(() => api(`${SETTINGS}/wifi?branchId=${branchId}`, { method: "DELETE" }), {
    invalidate: [[SETTINGS], [`${SETTINGS}?branchId=${branchId}`]],
    success: t("wifiInherited"),
  });
  const value = branchId ? scoped.data?.wifi : defaults;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("wifiIntro")}</p>
      {branches.length > 0 && (
        <SettingCard title={t("cards.wifiScope")}>
          <FormField label={t("wifiScope")} htmlFor="wf-scope" className="max-w-sm">
            <NativeSelect id="wf-scope" value={branchId} onChange={(e) => shell.guard(() => setBranchId(e.target.value))}>
              {organization && <option value="">{t("wifiAllBranches")}</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {text(b.name)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {branchId && (
            <Button
              variant="outline"
              size="sm"
              className="max-lg:h-10"
              disabled={clear.isPending}
              onClick={() => clear.mutate(undefined)}
            >
              {t("wifiUseDefault")}
            </Button>
          )}
        </SettingCard>
      )}
      {value ? (
        <SettingForm key={branchId} k="wifi" initial={value} branchId={branchId || null}>
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
      ) : (
        <LoadingRows rows={3} />
      )}
    </div>
  );
}
