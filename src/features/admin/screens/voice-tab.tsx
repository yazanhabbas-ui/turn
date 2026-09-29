"use client";

import { useTranslations } from "next-intl";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import type { SettingKey, SettingValue } from "@/server/settings/registry";
import { AudioPacks } from "./audio-packs";
import { VoicePhrases } from "./voice-phrases";
import { VoiceSettingsForm } from "./voice-settings";

type AllSettings = { [K in SettingKey]: SettingValue<K> };
export const SETTINGS = "/api/v1/admin/settings";

export function VoiceTab({ canSettings, canTemplates }: { canSettings: boolean; canTemplates: boolean }) {
  const t = useTranslations("screens");
  const settings = useApiQuery<AllSettings>(canSettings ? SETTINGS : null);
  if (canSettings && settings.isLoading) return <LoadingRows rows={5} />;
  if (canSettings && (settings.isError || !settings.data)) return <ErrorState onRetry={() => settings.refetch()} />;
  const voice = settings.data?.voice;
  const digits = settings.data?.regional.digitsVoice ?? "latn";

  return (
    <div className="space-y-8">
      {voice && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("voice.settingsTitle")}</h2>
          <VoiceSettingsForm initial={voice} />
        </section>
      )}
      {canTemplates && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("voice.phrasesTitle")}</h2>
            <VoicePhrases
              rate={voice?.rate ?? 0.9}
              volume={voice?.volume ?? 1}
              digits={digits}
              voiceNames={voice?.voiceNames ?? {}}
            />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("voice.packsTitle")}</h2>
            <AudioPacks />
          </section>
        </>
      )}
    </div>
  );
}
