"use client";

import { useTranslations } from "next-intl";
import { LocalizedInput } from "@/components/admin/form";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, Field, NumField } from "../setting-field";
import { ThemePicker } from "../../theme-picker";
import { SettingForm } from "../setting-form";

function ScreensLook({ initial, branding }: { initial: SettingValue<"displayTheme">; branding: SettingValue<"branding"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="displayTheme" initial={initial}>
      {(v, set) => (
        <SettingCard title={t("cards.displayLook")} description={t("displayThemeHint")}>
          <div id="dt-theme">
            <ThemePicker
              legend={t("displayTheme")}
              value={v.theme}
              onChange={(theme) => theme !== "default" && set({ theme })}
              primary={branding.primaryColor}
              accent={branding.accentColor}
            />
          </div>
        </SettingCard>
      )}
    </SettingForm>
  );
}

export function WallboardSection({
  initial,
  displayTheme,
  branding,
}: {
  initial: SettingValue<"wallboard">;
  displayTheme: SettingValue<"displayTheme">;
  branding: SettingValue<"branding">;
}) {
  return (
    <div className="space-y-4">
      <ScreensLook initial={displayTheme} branding={branding} />
      <WallboardForm initial={initial} />
    </div>
  );
}

function WallboardForm({ initial }: { initial: SettingValue<"wallboard"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="wallboard" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("wallboardIntro")}</p>
          <SettingCard title={t("cards.wallboardLook")} columns={2}>
            <Field label={t("wallboardTheme")} htmlFor="wb-theme">
              <NativeSelect id="wb-theme" value={v.theme} onChange={(e) => set({ theme: e.target.value as typeof v.theme })}>
                <option value="dark">{t("wallboardThemeDark")}</option>
                <option value="light">{t("wallboardThemeLight")}</option>
                <option value="brand">{t("wallboardThemeBrand")}</option>
              </NativeSelect>
            </Field>
            <NumField
              id="wb-scale"
              label={t("wallboardTextScale")}
              hint={t("wallboardTextScaleHint")}
              value={v.textScale}
              min={80}
              max={160}
              step={5}
              onChange={(textScale) => set({ textScale })}
            />
            <div className="sm:col-span-2">
              <LocalizedInput id="wb-title" label={t("wallboardTitle")} value={v.title} onChange={(title) => set({ title })} />
            </div>
          </SettingCard>
          <SettingCard title={t("cards.wallboardShow")} columns={2}>
            <Check id="wb-logo" label={t("wallboardShowLogo")} checked={v.showLogo} onChange={(showLogo) => set({ showLogo })} />
            <Check
              id="wb-company"
              label={t("wallboardShowCompanyName")}
              checked={v.showCompanyName}
              onChange={(showCompanyName) => set({ showCompanyName })}
            />
            <Check
              id="wb-branch"
              label={t("wallboardShowBranch")}
              checked={v.showBranch}
              onChange={(showBranch) => set({ showBranch })}
            />
            <Check
              id="wb-clock"
              label={t("wallboardShowClock")}
              checked={v.showClock}
              onChange={(showClock) => set({ showClock })}
            />
          </SettingCard>
          <p className="text-muted-foreground text-sm">{t("wallboardBrandHint")}</p>
        </>
      )}
    </SettingForm>
  );
}
