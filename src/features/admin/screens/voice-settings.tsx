"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SettingValue } from "@/server/settings/registry";
import { Check } from "./check";

type Voice = SettingValue<"voice">;
const SETTINGS = "/api/v1/admin/settings";

/** Voice settings, saved with PUT /settings/voice like the other setting groups. */
export function VoiceSettingsForm({ initial }: { initial: Voice }) {
  const t = useTranslations("screens.voice");
  const tu = useTranslations("ui");
  const [v, setV] = useState<Voice>(initial);
  useEffect(() => setV(initial), [initial]);
  const set = (patch: Partial<Voice>) => setV((x) => ({ ...x, ...patch }));
  const save = useApiMutation(() => api(`${SETTINGS}/voice`, { method: "PUT", body: v }), {
    invalidate: [[SETTINGS]],
    success: tu("saved"),
  });

  const both = v.languages.length === 2;
  const toggleLang = (code: "ar" | "en", on: boolean) =>
    set({ languages: on ? [...v.languages, code] : v.languages.filter((x) => x !== code) });

  return (
    <form
      className="bg-card max-w-3xl space-y-4 rounded-xl border p-4 shadow-sm md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Check label={t("enabled")} checked={v.enabled} onChange={(enabled) => set({ enabled })} />
        <Check label={t("chime")} checked={v.chime} onChange={(chime) => set({ chime })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("provider")} htmlFor="vs-provider" hint={v.provider === "cloud" ? t("cloudNote") : undefined}>
          <NativeSelect
            id="vs-provider"
            value={v.provider}
            onChange={(e) => set({ provider: e.target.value as Voice["provider"] })}
          >
            <option value="browser">{t("providers.browser")}</option>
            <option value="pack">{t("providers.pack")}</option>
            <option value="cloud">{t("providers.cloud")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("mode")} htmlFor="vs-mode">
          <NativeSelect id="vs-mode" value={v.mode} onChange={(e) => set({ mode: e.target.value as Voice["mode"] })}>
            <option value="sequence">{t("modes.sequence")}</option>
            <option value="ticket">{t("modes.ticket")}</option>
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">{t("languages")}</legend>
        <div className="flex flex-wrap items-center gap-4">
          <Check label={t("langAr")} checked={v.languages.includes("ar")} onChange={(on) => toggleLang("ar", on)} />
          <Check label={t("langEn")} checked={v.languages.includes("en")} onChange={(on) => toggleLang("en", on)} />
          {both && (
            <NativeSelect
              aria-label={t("order")}
              className="w-auto"
              value={v.languages[0]}
              onChange={(e) => set({ languages: e.target.value === "ar" ? ["ar", "en"] : ["en", "ar"] })}
            >
              <option value="ar">{t("arFirst")}</option>
              <option value="en">{t("enFirst")}</option>
            </NativeSelect>
          )}
        </div>
        {v.languages.length === 0 && <p className="text-destructive text-xs">{t("languagesRequired")}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t("repeat")} htmlFor="vs-repeat">
          <Input
            id="vs-repeat"
            type="number"
            min={1}
            max={5}
            value={v.repeat}
            onChange={(e) => set({ repeat: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("repeatGap")} htmlFor="vs-gap">
          <Input
            id="vs-gap"
            type="number"
            min={0}
            max={30}
            value={v.repeatGapSeconds}
            onChange={(e) => set({ repeatGapSeconds: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("volume", { value: Math.round(v.volume * 100) })} htmlFor="vs-vol">
          <input
            id="vs-vol"
            type="range"
            min={0}
            max={100}
            className="accent-brand mt-2 w-full"
            value={Math.round(v.volume * 100)}
            onChange={(e) => set({ volume: Number(e.target.value) / 100 })}
          />
        </Field>
        <Field label={t("rate")} htmlFor="vs-rate">
          <Input
            id="vs-rate"
            type="number"
            step={0.05}
            min={0.5}
            max={1.5}
            value={v.rate}
            onChange={(e) => set({ rate: Number(e.target.value) })}
          />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("voiceNames")}</legend>
        <p className="text-muted-foreground text-xs">{t("voiceNamesHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["ar", "en"] as const).map((code) => (
            <Input
              key={code}
              dir="ltr"
              lang={code}
              aria-label={`${t("voiceNames")} (${code})`}
              placeholder={code === "ar" ? t("langAr") : t("langEn")}
              value={v.voiceNames[code] ?? ""}
              onChange={(e) => set({ voiceNames: { ...v.voiceNames, [code]: e.target.value } })}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={save.isPending || v.languages.length === 0}>
          {tu("save")}
        </Button>
      </div>
    </form>
  );
}
