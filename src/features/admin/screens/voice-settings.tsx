"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { buildArabicUnits, TICKET_READINGS, unitsText } from "@/domain/display/arabic-speech";
import { CALL_LANGUAGES } from "@/domain/display/speech";
import type { DigitSystem } from "@/domain/i18n/digits";
import type { SettingValue } from "@/server/settings/registry";
import { ArabicVoice } from "./arabic-voice";
import { Check } from "./check";
import { VoicePreview } from "./voice-preview";
import { Range, SettingCard } from "./voice-parts";

type Voice = SettingValue<"voice">;
const SETTINGS = "/api/v1/admin/settings";

/** The values the "Reset to natural defaults" button restores (the same as the setting defaults). */
const NATURAL: Partial<Voice> = {
  gapPhraseMs: 180,
  gapLetterNumberMs: 120,
  gapDeskMs: 350,
  gapChimeMs: 250,
  overlapMs: 0,
  speed: 1,
};

/**
 * Voice settings in clearly separated groups (what is said, how often, timing, sound, test), saved together with
 * PUT /settings/voice. The test area plays with the values on the page, saved or not.
 */
export function VoiceSettingsForm({
  initial,
  digits,
  canTemplates,
  canSettings,
}: {
  initial: Voice;
  digits: DigitSystem;
  canTemplates: boolean;
  canSettings: boolean;
}) {
  const t = useTranslations("screens.voice");
  const tu = useTranslations("ui");
  const [v, setV] = useState<Voice>(initial);
  // Choosing a voice in the picker saves at once on the server; follow it without losing other unsaved edits.
  useEffect(() => setV((x) => ({ ...x, provider: initial.provider })), [initial.provider]);
  const set = (patch: Partial<Voice>) => setV((x) => ({ ...x, ...patch }));
  const dirty = useMemo(() => JSON.stringify(v) !== JSON.stringify(initial), [v, initial]);
  const save = useApiMutation(() => api(`${SETTINGS}/voice`, { method: "PUT", body: v }), {
    invalidate: [[SETTINGS]],
    success: tu("saved"),
  });

  const example = (reading: Voice["ticketReading"]) =>
    unitsText(buildArabicUnits({ ticket: "B-014", reading, includeDesk: false }));

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <SettingCard title={t("announcedTitle")} hint={t("announcedHint")}>
        <Check label={t("enabled")} checked={v.enabled} onChange={(enabled) => set({ enabled })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("callLanguages")} htmlFor="vs-cl" hint={t("callLanguagesHint")}>
            <NativeSelect
              id="vs-cl"
              value={v.callLanguages}
              onChange={(e) => set({ callLanguages: e.target.value as Voice["callLanguages"] })}
            >
              {CALL_LANGUAGES.map((c) => (
                <option key={c} value={c}>
                  {t(`callLanguageOptions.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("ticketReading")} htmlFor="vs-tr" hint={t("ticketReadingHint")}>
            <NativeSelect
              id="vs-tr"
              value={v.ticketReading}
              onChange={(e) => set({ ticketReading: e.target.value as Voice["ticketReading"] })}
            >
              {TICKET_READINGS.map((r) => (
                <option key={r} value={r}>
                  {`${t(`readingOptions.${r}`)} — ${example(r)}`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Check
          label={t("announceDesk")}
          hint={t("announceDeskHint")}
          checked={v.announceDesk}
          onChange={(announceDesk) => set({ announceDesk })}
        />
      </SettingCard>

      <SettingCard title={t("repeatTitle")} hint={t("repeatHint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("repeat")} htmlFor="vs-repeat">
            <Input
              id="vs-repeat"
              type="number"
              min={1}
              max={5}
              value={v.repeat}
              onChange={(e) => set({ repeat: Math.min(5, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
            />
          </Field>
          <Range
            id="vs-gap"
            label={t("repeatGap")}
            value={v.repeatGapSeconds}
            display={t("seconds", { value: v.repeatGapSeconds })}
            min={0.5}
            max={10}
            step={0.5}
            onChange={(repeatGapSeconds) => set({ repeatGapSeconds })}
          />
        </div>
      </SettingCard>

      <SettingCard title={t("timingTitle")} hint={t("timingHint")}>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Range
            id="vs-gp"
            label={t("gapPhrase")}
            value={v.gapPhraseMs}
            display={t("ms", { value: v.gapPhraseMs })}
            min={0}
            max={800}
            step={10}
            onChange={(gapPhraseMs) => set({ gapPhraseMs })}
          />
          <Range
            id="vs-gl"
            label={t("gapLetterNumber")}
            value={v.gapLetterNumberMs}
            display={t("ms", { value: v.gapLetterNumberMs })}
            min={0}
            max={800}
            step={10}
            onChange={(gapLetterNumberMs) => set({ gapLetterNumberMs })}
          />
          <Range
            id="vs-gd"
            label={t("gapDesk")}
            value={v.gapDeskMs}
            display={t("ms", { value: v.gapDeskMs })}
            min={0}
            max={1500}
            step={10}
            onChange={(gapDeskMs) => set({ gapDeskMs })}
          />
          <Range
            id="vs-gc"
            label={t("gapChime")}
            value={v.gapChimeMs}
            display={t("ms", { value: v.gapChimeMs })}
            min={0}
            max={1500}
            step={10}
            onChange={(gapChimeMs) => set({ gapChimeMs })}
          />
          <Range
            id="vs-ov"
            label={t("overlap")}
            hint={t("overlapHint")}
            value={v.overlapMs}
            display={t("ms", { value: v.overlapMs })}
            min={0}
            max={120}
            step={5}
            onChange={(overlapMs) => set({ overlapMs })}
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => set(NATURAL)}>
            <RotateCcw aria-hidden />
            {t("resetTiming")}
          </Button>
        </div>
      </SettingCard>

      <SettingCard title={t("soundTitle")} hint={t("soundHint")}>
        {canTemplates && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t("arabicTitle")}</h4>
            <ArabicVoice voice={initial} draft={v} canSettings={canSettings} digits={digits} />
          </div>
        )}
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
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
          <Range
            id="vs-vol"
            label={t("volumeLabel")}
            value={Math.round(v.volume * 100)}
            display={`${Math.round(v.volume * 100)}%`}
            min={0}
            max={100}
            step={5}
            onChange={(p) => set({ volume: p / 100 })}
          />
          <Range
            id="vs-speed"
            label={t("speed")}
            hint={t("speedHint")}
            value={v.speed}
            display={`${v.speed.toFixed(2)}×`}
            min={0.8}
            max={1.25}
            step={0.05}
            onChange={(speed) => set({ speed })}
          />
          <Range
            id="vs-rate"
            label={t("rate")}
            hint={t("rateHint")}
            value={v.rate}
            display={`${v.rate.toFixed(2)}×`}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(rate) => set({ rate })}
          />
          <Check label={t("chime")} checked={v.chime} onChange={(chime) => set({ chime })} />
          <Range
            id="vs-cv"
            label={t("chimeVolume")}
            value={Math.round(v.chimeVolume * 100)}
            display={`${Math.round(v.chimeVolume * 100)}%`}
            min={0}
            max={100}
            step={5}
            onChange={(p) => set({ chimeVolume: p / 100 })}
          />
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
      </SettingCard>

      <VoicePreview draft={v} digits={digits} />

      <div className="bg-background/90 sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-3 border-t px-1 py-3 backdrop-blur">
        {dirty && <span className="text-muted-foreground text-xs">{t("unsaved")}</span>}
        <Button type="submit" disabled={save.isPending || !dirty}>
          {tu("save")}
        </Button>
      </div>
    </form>
  );
}
