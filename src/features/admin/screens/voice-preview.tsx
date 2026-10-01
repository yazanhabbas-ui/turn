"use client";

import { Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Field } from "@/components/admin/form";
import { useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { CallLanguages } from "@/domain/display/speech";
import type { DigitSystem } from "@/domain/i18n/digits";
import type { PlanInput } from "@/features/display/voice/job";
import type { SettingValue } from "@/server/settings/registry";
import { SettingCard } from "./voice-parts";
import { describeCall, previewTemplates, useVoicePreview } from "./use-voice-preview";
import type { AudioPack, VoiceTemplate } from "./types";

const TEMPLATES = "/api/v1/admin/templates";
const PACKS = "/api/v1/admin/audio-packs";

/**
 * The test area: plays a sample call through the same engine as a screen, using the values currently on the page
 * (saved or not), and shows the exact words that are spoken.
 */
export function VoicePreview({ draft, digits }: { draft: SettingValue<"voice">; digits: DigitSystem }) {
  const t = useTranslations("screens.voice");
  const templates = useApiQuery<{ items: VoiceTemplate[] }>(TEMPLATES);
  const packs = useApiQuery<{ items: AudioPack[] }>(PACKS);
  const [ticket, setTicket] = useState("B-014");
  const [desk, setDesk] = useState("3");
  const [ticketLanguage, setTicketLanguage] = useState<"ar" | "en">("ar");
  const preview = useVoicePreview(t("noVoiceHere"));

  const input = useMemo<PlanInput>(() => {
    const saved: Record<string, Record<string, string>> = {};
    for (const x of templates.data?.items ?? []) if (x.channel === "voice") saved[x.event] = x.body;
    const active = packs.data?.items.find((p) => p.locale === "ar" && p.isActive);
    const manifests: PlanInput["packs"] = active ? { ar: active.manifest } : {};
    return {
      settings: draft,
      templates: previewTemplates(saved),
      packs: manifests,
      digits,
      displayNumber: ticket.trim() || "B-014",
      deskNumber: desk.trim() || null,
      ticketLanguage,
    };
  }, [draft, templates.data, packs.data, digits, ticket, desk, ticketLanguage]);

  const asConfigured = describeCall(input);
  const run = (callLanguages?: CallLanguages, repeat?: number) => void preview.play({ ...input, callLanguages, repeat });

  return (
    <SettingCard id="voice-test" title={t("testTitle")} hint={t("testAreaHint")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("testTicket")} htmlFor="vt-ticket">
          <Input id="vt-ticket" dir="ltr" value={ticket} onChange={(e) => setTicket(e.target.value)} />
        </Field>
        <Field label={t("testDesk")} htmlFor="vt-desk">
          <Input id="vt-desk" dir="ltr" value={desk} onChange={(e) => setDesk(e.target.value)} />
        </Field>
        {draft.callLanguages === "ticket" && (
          <Field label={t("testVisitorLanguage")} htmlFor="vt-lang">
            <NativeSelect id="vt-lang" value={ticketLanguage} onChange={(e) => setTicketLanguage(e.target.value as "ar" | "en")}>
              <option value="ar">{t("langAr")}</option>
              <option value="en">{t("langEn")}</option>
            </NativeSelect>
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={() => run("ar", 1)}>
          <Play aria-hidden />
          {t("playAr")}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => run("en", 1)}>
          <Play aria-hidden />
          {t("playEn")}
        </Button>
        <Button type="button" size="lg" variant="secondary" onClick={() => run()}>
          <Play aria-hidden />
          {t("playConfigured")}
        </Button>
        {preview.playing && (
          <Button type="button" size="lg" variant="ghost" onClick={preview.stop}>
            <Square aria-hidden />
            {t("stop")}
          </Button>
        )}
      </div>

      <div className="bg-muted space-y-2 rounded-lg p-3" aria-live="polite">
        <div className="text-muted-foreground text-xs font-medium">{t("spokenText")}</div>
        {asConfigured.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          asConfigured.map((s) => (
            <p key={s.locale} lang={s.locale} dir={s.locale === "ar" ? "rtl" : "ltr"} className="text-lg leading-relaxed">
              {s.text}
              <span className="text-muted-foreground ms-2 text-xs" dir="auto">
                {s.source === "pack" ? t("sourcePack") : t("sourceBrowser")}
              </span>
            </p>
          ))
        )}
      </div>
    </SettingCard>
  );
}
