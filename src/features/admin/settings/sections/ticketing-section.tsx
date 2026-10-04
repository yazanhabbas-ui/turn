"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, Field } from "../setting-field";
import { SettingForm } from "../setting-form";

export function TicketingSection({ initial }: { initial: SettingValue<"ticketing"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="ticketing" initial={initial}>
      {(v, set) => (
        <>
          <SettingCard title={t("cards.numbering")} columns={3}>
            <Field label={t("numberPad")} htmlFor="tk-pad" hint={t("numberPadHint")}>
              <Input
                id="tk-pad"
                type="number"
                min={0}
                max={6}
                value={v.numberPad}
                onChange={(e) => set({ numberPad: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("separator")} htmlFor="tk-sep">
              <Input
                id="tk-sep"
                maxLength={3}
                dir="ltr"
                value={v.separator}
                onChange={(e) => set({ separator: e.target.value })}
              />
            </Field>
            <Field label={t("dailyResetTime")} htmlFor="tk-reset" hint={t("dailyResetHint")}>
              <Input
                id="tk-reset"
                type="time"
                dir="ltr"
                value={v.dailyResetTime}
                onChange={(e) => set({ dailyResetTime: e.target.value })}
              />
            </Field>
            <Field label={t("numberResetAfter")} htmlFor="tk-resetafter" hint={t("numberResetAfterHint")}>
              <Input
                id="tk-resetafter"
                type="number"
                min={0}
                max={9999}
                value={v.numberResetAfter}
                onChange={(e) => set({ numberResetAfter: Number(e.target.value) })}
              />
            </Field>
          </SettingCard>
          <SettingCard title={t("cards.callByPhone")}>
            <Check
              id="tk-callphone"
              label={t("callByPhone")}
              hint={t("callByPhoneHint")}
              checked={v.callByPhone}
              onChange={(callByPhone) => set({ callByPhone })}
            />
            {v.callByPhone && (
              <Field label={t("callByPhoneDigits")} htmlFor="tk-calldigits">
                <Input
                  id="tk-calldigits"
                  type="number"
                  min={2}
                  max={6}
                  className="max-w-32"
                  value={v.callByPhoneDigits}
                  onChange={(e) => set({ callByPhoneDigits: Number(e.target.value) })}
                />
              </Field>
            )}
          </SettingCard>
          <SettingCard title={t("cards.printedTicket")}>
            <Check
              id="tk-qr"
              label={t("showQrOnTicket")}
              checked={v.showQrOnTicket}
              onChange={(showQrOnTicket) => set({ showQrOnTicket })}
            />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
