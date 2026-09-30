"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "../setting-card";
import { Check, Field, NumField } from "../setting-field";
import { SettingForm } from "../setting-form";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parse = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** One email per line. Invalid lines block the form's native submit and are listed under the box. */
function EmailsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("settings");
  const [text, setText] = useState(value.join("\n"));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText((cur) => (parse(cur).join("\n") === value.join("\n") ? cur : value.join("\n"))), [value]);
  const bad = parse(text).filter((e) => !EMAIL_RE.test(e));
  const tooMany = parse(text).length > 20;
  useEffect(() => {
    ref.current?.setCustomValidity(bad.length || tooMany ? t("notifyEmailsInvalid") : "");
  }, [bad.length, tooMany, t]);
  return (
    <Field label={t("notifyEmails")} htmlFor="al-emails" hint={t("notifyEmailsHint")}>
      <textarea
        id="al-emails"
        ref={ref}
        dir="ltr"
        rows={4}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-3"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
      />
      {(bad.length > 0 || tooMany) && (
        <p className="text-destructive mt-1 text-xs" role="alert">
          {t("notifyEmailsInvalid")}
          {bad.length > 0 && <span dir="ltr"> {bad.join(", ")}</span>}
        </p>
      )}
    </Field>
  );
}

export function AlertsSection({ initial }: { initial: SettingValue<"alerts"> }) {
  const t = useTranslations("settings");
  return (
    <SettingForm k="alerts" initial={initial}>
      {(v, set) => (
        <>
          <p className="text-muted-foreground text-sm">{t("alertsIntro")}</p>
          <SettingCard title={t("cards.alertsSwitch")}>
            <Check
              id="al-enabled"
              label={t("alertsEnabled")}
              hint={t("alertsEnabledHint")}
              checked={v.enabled}
              onChange={(enabled) => set({ enabled })}
            />
          </SettingCard>
          <SettingCard title={t("cards.alertRules")} columns={2}>
            <NumField
              id="al-long"
              label={t("longWaitMinutes")}
              hint={t("longWaitMinutesHint")}
              value={v.longWaitMinutes}
              min={1}
              max={240}
              onChange={(longWaitMinutes) => set({ longWaitMinutes })}
            />
            <NumField
              id="al-limit"
              label={t("queueLimit")}
              hint={t("queueLimitHint")}
              value={v.queueLimit}
              min={1}
              max={500}
              onChange={(queueLimit) => set({ queueLimit })}
            />
            <NumField
              id="al-idle"
              label={t("agentIdleMinutes")}
              hint={t("agentIdleMinutesHint")}
              value={v.agentIdleMinutes}
              min={1}
              max={240}
              onChange={(agentIdleMinutes) => set({ agentIdleMinutes })}
            />
            <NumField
              id="al-ns"
              label={t("noShowCount")}
              hint={t("noShowCountHint")}
              value={v.noShowCount}
              min={1}
              max={50}
              onChange={(noShowCount) => set({ noShowCount })}
            />
            <NumField
              id="al-nsw"
              label={t("noShowWindowMinutes")}
              hint={t("noShowWindowMinutesHint")}
              value={v.noShowWindowMinutes}
              min={5}
              max={240}
              onChange={(noShowWindowMinutes) => set({ noShowWindowMinutes })}
            />
          </SettingCard>
          <SettingCard title={t("cards.alertRecipients")}>
            <EmailsField value={v.notifyEmails} onChange={(notifyEmails) => set({ notifyEmails })} />
          </SettingCard>
        </>
      )}
    </SettingForm>
  );
}
