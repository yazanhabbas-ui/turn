"use client";

import { useTranslations } from "next-intl";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, Field } from "../setting-field";
import { SettingForm } from "../setting-form";

export function ReceptionSection({ initial }: { initial: SettingValue<"reception"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="reception" initial={initial}>
      {(v, set) => (
        <>
          <SettingCard title={t("cards.issuing")} description={t("receptionIntro")} columns={2}>
            <Check
              id="rc-onetap"
              label={t("oneTapIssue")}
              hint={t("oneTapIssueHint")}
              checked={v.oneTapIssue}
              onChange={(oneTapIssue) => set({ oneTapIssue })}
            />
            <Check
              id="rc-print"
              label={t("autoPrintDefault")}
              hint={t("autoPrintDefaultHint")}
              checked={v.autoPrint}
              onChange={(autoPrint) => set({ autoPrint })}
            />
            <Check
              id="rc-prio"
              label={t("askPriority")}
              hint={t("askPriorityHint")}
              checked={v.askPriority}
              onChange={(askPriority) => set({ askPriority })}
            />
            <Check
              id="rc-ask-lang"
              label={t("askLanguage")}
              hint={t("askLanguageHint")}
              checked={v.askLanguage}
              onChange={(askLanguage) => set({ askLanguage })}
            />
          </SettingCard>
          <SettingCard title={t("cards.afterIssue")} description={t("receptionDataHint")} columns={2}>
            <Field label={t("afterIssue")} htmlFor="rc-after">
              <NativeSelect
                id="rc-after"
                value={v.afterIssue}
                onChange={(e) => set({ afterIssue: e.target.value as typeof v.afterIssue })}
              >
                <option value="print">{t("afterIssuePrint")}</option>
                <option value="dialog">{t("afterIssueDialog")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("defaultLanguage")} htmlFor="rc-lang">
              <NativeSelect
                id="rc-lang"
                value={v.defaultLanguage}
                onChange={(e) => set({ defaultLanguage: e.target.value as typeof v.defaultLanguage })}
              >
                <option value="interface">{t("languageInterface")}</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </NativeSelect>
            </Field>
          </SettingCard>
          <SettingCard title={t("cards.agentIssuing")} description={t("agentIssuingIntro")}>
            <Field label={t("agentIssuing")} htmlFor="rc-agent" hint={t("agentIssuingHint")}>
              <NativeSelect
                id="rc-agent"
                value={v.agentIssuing}
                onChange={(e) => set({ agentIssuing: e.target.value as typeof v.agentIssuing })}
              >
                <option value="off">{t("agentIssuingOff")}</option>
                <option value="when_no_reception">{t("agentIssuingWhenNone")}</option>
                <option value="always">{t("agentIssuingAlways")}</option>
              </NativeSelect>
            </Field>
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
