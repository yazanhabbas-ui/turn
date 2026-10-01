"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { packSpokenText } from "@/domain/display/plan";
import { VoiceEngine } from "@/features/display/voice/engine";
import { buildVoiceJob, planCall, type PlanInput } from "@/features/display/voice/job";
import { PackTts } from "@/features/display/voice/providers";
import type { L } from "../types";

/** The sentence used when no phrase has been saved yet (the same starting point as the phrase editor). */
export const DEFAULT_PHRASES: L = {
  ar: "على العميل صاحب الرقم {ticket} التوجه إلى المكتب {desk}",
  en: "Ticket {ticket}, please proceed to desk {desk}",
};

/** Templates for a preview: the saved ones, filled in with the defaults where a language has none. */
export function previewTemplates(saved: Record<string, Record<string, string>> | undefined) {
  const called = { ...DEFAULT_PHRASES, ...(saved?.ticket_called ?? {}) } as Record<string, string>;
  return { ...(saved ?? {}), ticket_called: called };
}

/** What would be spoken, per language: the pack's words when the recorded voice can say it, else the phrase text. */
export function describeCall(input: PlanInput): { locale: string; text: string; source: "pack" | "browser" }[] {
  const pack = new PackTts(input.packs);
  return planCall(input).map((step) => {
    const viaPack = input.settings.provider === "pack" && pack.supports(step);
    return { locale: step.locale, text: viaPack ? packSpokenText([step]) : step.text, source: viaPack ? "pack" : "browser" };
  });
}

/**
 * Plays a call through the very same engine and job builder as a TV screen, with whatever settings the admin
 * currently has on screen (saved or not). Must be started from a click so the browser allows sound.
 */
export function useVoicePreview(unavailableMessage: string) {
  const engine = useRef<VoiceEngine | null>(null);
  const [playing, setPlaying] = useState(false);
  const message = useRef(unavailableMessage);
  message.current = unavailableMessage;

  useEffect(() => {
    const e = new VoiceEngine({
      onStart: () => setPlaying(true),
      onEnd: () => setPlaying(false),
      onUnavailable: () => toast.error(message.current),
    });
    engine.current = e;
    return () => {
      e.clear();
      setPlaying(false);
    };
  }, []);

  async function play(input: PlanInput) {
    const e = engine.current;
    if (!e) return;
    await e.unlock();
    e.clear();
    const job = buildVoiceJob({ ...input, id: `preview:${Date.now()}` });
    if (job) e.enqueue(job);
  }
  function stop() {
    engine.current?.clear();
    setPlaying(false);
  }
  return { play, stop, playing };
}
