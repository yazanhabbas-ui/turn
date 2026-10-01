"use client";

import { Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { arabicDeskWords, arabicTicketWords, type TicketReading } from "@/domain/display/arabic-speech";
import { announcementText } from "@/domain/display/speech";
import { renderTemplate } from "@/domain/templates/render";
import type { DigitSystem } from "@/domain/i18n/digits";
import type { L } from "../types";
import type { VoiceTemplate } from "./types";
import { DEFAULT_PHRASES } from "./use-voice-preview";

const TEMPLATES = "/api/v1/admin/templates";
const PLACEHOLDERS = ["ticket", "desk", "agent", "reason"] as const;
const LANGS = [
  { code: "ar", dir: "rtl", speech: "ar-SA" },
  { code: "en", dir: "ltr", speech: "en-US" },
] as const;
const SAMPLE = { ticket: "B-014", desk: "3", agent: "", reason: "" };

export function VoicePhrases({
  rate,
  volume,
  digits,
  voiceNames,
  reading,
}: {
  reading: TicketReading;
  rate: number;
  volume: number;
  digits: DigitSystem;
  voiceNames: L;
}) {
  const t = useTranslations("screens.voice");
  const tu = useTranslations("ui");
  const list = useApiQuery<{ items: VoiceTemplate[] }>(TEMPLATES);
  const [body, setBody] = useState<L>(DEFAULT_PHRASES);
  const focused = useRef<"ar" | "en">("ar");
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const saved = list.data?.items.find((x) => x.channel === "voice" && x.event === "ticket_called");

  useEffect(() => {
    if (saved) setBody({ ...DEFAULT_PHRASES, ...saved.body });
  }, [saved]);

  const save = useApiMutation(
    () => api(TEMPLATES, { method: "PUT", body: { channel: "voice", event: "ticket_called", body, isActive: true } }),
    { invalidate: [[TEMPLATES]], success: tu("saved") },
  );

  if (list.isLoading) return <LoadingRows rows={2} />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;

  function insert(name: string) {
    const code = focused.current;
    const el = refs.current[code];
    const token = `{${name}}`;
    const cur = body[code] ?? "";
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    setBody({ ...body, [code]: cur.slice(0, start) + token + cur.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function speak(code: "ar" | "en", speech: string, textToSpeak: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return toast.error(t("noVoice", { lang: speech }));
    const voices = window.speechSynthesis.getVoices();
    const forLang = voices.filter((v) => v.lang.toLowerCase().startsWith(code));
    if (forLang.length === 0) return toast.error(t("noVoice", { lang: code === "ar" ? t("langAr") : t("langEn") }));
    const preferred = voiceNames[code]?.toLowerCase();
    const u = new SpeechSynthesisUtterance(textToSpeak);
    u.lang = speech;
    u.voice = (preferred && forLang.find((v) => v.name.toLowerCase().startsWith(preferred))) || forLang[0];
    u.rate = rate;
    u.volume = volume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="bg-card max-w-3xl space-y-4 rounded-xl border p-4 shadow-sm md:p-6">
      <p className="text-muted-foreground text-sm">{t("phrasesHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("placeholders")}</span>
        {PLACEHOLDERS.map((p) => (
          <Button key={p} type="button" variant="outline" size="sm" dir="ltr" className="font-mono" onClick={() => insert(p)}>
            {`{${p}}`}
          </Button>
        ))}
      </div>
      {LANGS.map(({ code, dir, speech }) => {
        // Arabic is spoken with the ticket and desk as words (the recorded voice does the same).
        const preview =
          code === "ar"
            ? renderTemplate(body[code] ?? "", {
                ticket: arabicTicketWords(SAMPLE.ticket, reading),
                desk: arabicDeskWords(SAMPLE.desk),
                agent: "",
                reason: "",
              })
            : announcementText(body[code] ?? "", { ...SAMPLE, reading }, digits);
        return (
          <div key={code} className="space-y-1.5">
            <Label htmlFor={`ph-${code}`}>{code === "ar" ? t("langAr") : t("langEn")}</Label>
            <Textarea
              id={`ph-${code}`}
              ref={(el) => {
                refs.current[code] = el;
              }}
              dir={dir}
              lang={code}
              rows={2}
              value={body[code] ?? ""}
              onFocus={() => (focused.current = code)}
              onChange={(e) => setBody({ ...body, [code]: e.target.value })}
            />
            <div className="bg-muted flex flex-wrap items-center gap-2 rounded-md p-2 text-sm">
              <span className="text-muted-foreground text-xs">{t("preview")}</span>
              <span dir={dir} lang={code} className="flex-1">
                {preview || "—"}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={!preview} onClick={() => speak(code, speech, preview)}>
                <Volume2 aria-hidden />
                {t("test")}
              </Button>
            </div>
          </div>
        );
      })}
      <p className="text-muted-foreground text-xs">{t("testHint")}</p>
      <div className="flex justify-end border-t pt-4">
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          {tu("save")}
        </Button>
      </div>
    </div>
  );
}
