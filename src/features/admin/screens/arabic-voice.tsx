"use client";

import { Check, Play, Plus, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { packClipKeys } from "@/domain/display/speech";
import { PackTts } from "@/features/display/voice/providers";
import { cn } from "@/lib/utils";
import type { SettingValue } from "@/server/settings/registry";
import { SETTINGS } from "./voice-tab";
import type { AudioPack } from "./types";

const PACKS = "/api/v1/admin/audio-packs";

/** A sample announcement (ticket A-12 at desk 3) spoken from the pack's own clips, exactly as a screen would. */
function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<PackTts | null>(null);
  useEffect(() => () => player.current?.stop(), []);
  async function play(pack: AudioPack, rate: number, volume: number) {
    player.current?.stop();
    setPlaying(pack.id);
    const tts = new PackTts({ ar: pack.manifest });
    player.current = tts;
    try {
      await tts.speak({ locale: "ar", text: "", keys: packClipKeys("A-012", "3", "ar") }, { rate, volume });
    } catch {
      /* a missing clip just ends the preview */
    } finally {
      setPlaying((p) => (p === pack.id ? null : p));
    }
  }
  function stop() {
    player.current?.stop();
    setPlaying(null);
  }
  return { playing, play, stop };
}

/**
 * Picks who speaks the Arabic announcements: the screen's own browser voice, or one of the bundled recorded
 * voices. Choosing takes effect on every paired screen immediately.
 */
export function ArabicVoice({ voice, canSettings }: { voice: SettingValue<"voice">; canSettings: boolean }) {
  const t = useTranslations("screens.voice");
  const list = useApiQuery<{ items: AudioPack[] }>(PACKS);
  const preview = usePreview();
  const invalidate = [[PACKS], [SETTINGS]];

  const use = useApiMutation((id: string) => api(`${PACKS}/${id}/activate`, { body: {} }), { invalidate });
  const browser = useApiMutation(() => api(`${SETTINGS}/voice`, { method: "PUT", body: { ...voice, provider: "browser" } }), {
    invalidate,
  });
  const install = useApiMutation(() => api<{ added: number; total: number }>(`${PACKS}/install-bundled`, { body: {} }), {
    invalidate,
    success: t("bundledAdded"),
  });

  if (list.isLoading) return <LoadingRows rows={3} />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;
  const packs = list.data.items.filter((p) => p.locale === "ar");
  const usingPack = voice.provider === "pack";

  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-muted-foreground text-sm">{t("arabicHint")}</p>

      {canSettings && (
        <Choice
          selected={!usingPack}
          title={t("browserVoice")}
          hint={t("browserVoiceHint")}
          onUse={() => browser.mutate(undefined)}
          busy={browser.isPending}
          inUse={t("inUse")}
          useLabel={t("useVoice")}
        />
      )}

      {packs.length === 0 ? (
        <EmptyState title={t("noBundled")} />
      ) : (
        packs.map((p) => {
          const on = usingPack && p.isActive;
          return (
            <Choice
              key={p.id}
              selected={on}
              title={p.name}
              hint={t("clips", { count: p.clips })}
              onUse={() => use.mutate(p.id)}
              busy={use.isPending}
              inUse={t("inUse")}
              useLabel={t("useVoice")}
              extra={
                preview.playing === p.id ? (
                  <Button variant="outline" size="sm" onClick={preview.stop}>
                    <Square aria-hidden />
                    {t("stop")}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void preview.play(p, voice.rate, voice.volume)}>
                    <Play aria-hidden />
                    {t("preview")}
                  </Button>
                )
              }
            />
          );
        })
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button variant="outline" size="sm" disabled={install.isPending} onClick={() => install.mutate(undefined)}>
          <Plus aria-hidden />
          {t("addBundled")}
        </Button>
        <span className="text-muted-foreground text-xs">{t("bundledNote")}</span>
      </div>
    </div>
  );
}

function Choice({
  selected,
  title,
  hint,
  onUse,
  busy,
  inUse,
  useLabel,
  extra,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onUse: () => void;
  busy: boolean;
  inUse: string;
  useLabel: string;
  extra?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3",
        selected && "border-brand ring-brand/20 ring-2",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {selected && (
            <Badge>
              <Check aria-hidden />
              {inUse}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground text-xs">{hint}</div>
      </div>
      {extra}
      {!selected && (
        <Button size="sm" disabled={busy} onClick={onUse}>
          {useLabel}
        </Button>
      )}
    </div>
  );
}
