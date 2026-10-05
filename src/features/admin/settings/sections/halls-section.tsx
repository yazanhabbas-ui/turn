"use client";

import { useTranslations } from "next-intl";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, Field, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";
import { NativeSelect } from "@/components/ui/native-select";

const GROUP_MODES = ["same_reason", "any_reason"] as const;
const ANNOUNCE_MODES = ["list", "range", "hall_only"] as const;

/**
 * Halls (D62): rooms where one host receives several visitors together. The organization default, a city's or a
 * branch's own value is chosen with the scope switcher at the top of the page; the halls themselves are created under
 * Admin → Branches, and a reason is made a hall reason in its editor.
 */
export function HallsSection({ initial }: { initial: SettingValue<"halls"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="halls" initial={initial}>
      {(v, set) => (
        <>
          <SettingCard title={t("cards.hallsGeneral")} description={t("hallsIntro")} columns={2}>
            <div className="sm:col-span-2">
              <Check
                id="hl-enabled"
                label={t("hallsEnabled")}
                hint={t("hallsEnabledHint")}
                checked={v.enabled}
                onChange={(enabled) => set({ enabled })}
              />
            </div>
            <Field label={t("hallsGroupMode")} htmlFor="hl-mode" hint={t(`hallsGroupMode_${v.groupMode}_hint`)}>
              <NativeSelect
                id="hl-mode"
                value={v.groupMode}
                onChange={(e) => set({ groupMode: e.target.value as (typeof GROUP_MODES)[number] })}
              >
                {GROUP_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`hallsGroupMode_${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <NumField
              id="hl-min"
              label={t("hallsMinGroup")}
              hint={t("hallsMinGroupHint")}
              value={v.minGroup}
              min={1}
              max={100}
              onChange={(minGroup) => set({ minGroup })}
            />
            <NumField
              id="hl-max"
              label={t("hallsMaxGroup")}
              hint={t("hallsMaxGroupHint")}
              value={v.maxGroup}
              min={0}
              max={200}
              onChange={(maxGroup) => set({ maxGroup })}
            />
          </SettingCard>
          <SettingCard title={t("cards.hallsSession")} columns={2}>
            <Check
              id="hl-topup"
              label={t("hallsAllowTopUp")}
              hint={t("hallsAllowTopUpHint")}
              checked={v.allowTopUp}
              onChange={(allowTopUp) => set({ allowTopUp })}
            />
            <Check
              id="hl-auto"
              label={t("hallsAutoStart")}
              hint={t("hallsAutoStartHint")}
              checked={v.autoStartWhenAllEntered}
              onChange={(autoStartWhenAllEntered) => set({ autoStartWhenAllEntered })}
            />
          </SettingCard>
          <SettingCard title={t("cards.hallsAnnounce")} description={t("hallsAnnounceIntro")} columns={2}>
            <Field label={t("hallsAnnounceMode")} htmlFor="hl-announce" hint={t(`hallsAnnounceMode_${v.announceMode}_hint`)}>
              <NativeSelect
                id="hl-announce"
                value={v.announceMode}
                onChange={(e) => set({ announceMode: e.target.value as (typeof ANNOUNCE_MODES)[number] })}
              >
                {ANNOUNCE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`hallsAnnounceMode_${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <NumField
              id="hl-announced"
              label={t("hallsMaxAnnounced")}
              hint={t("hallsMaxAnnouncedHint")}
              value={v.maxAnnounced}
              min={1}
              max={30}
              disabled={v.announceMode === "hall_only"}
              onChange={(maxAnnounced) => set({ maxAnnounced })}
            />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
