import { planHallAnnouncement } from "@/domain/display/hall-speech";
import { planAnnouncement, type PlannedStep } from "@/domain/display/plan";
import type { AnnounceMode } from "@/domain/halls/announce";
import type { CallLanguages } from "@/domain/display/speech";
import type { DigitSystem } from "@/domain/i18n/digits";
import type { SettingValue } from "@/server/settings/registry";
import type { VoiceJob } from "./engine";
import { packVoiceId } from "@/domain/display/edge-voices";
import { BrowserTts, CloudTts, PackTts, type TtsProvider } from "./providers";

export type VoiceSettings = SettingValue<"voice">;

/** Everything a screen (or the admin preview) needs to announce one call. */
export type PlanInput = {
  settings: VoiceSettings;
  templates: Record<string, Record<string, string>>;
  /** Clip manifests by language (the active pack). */
  packs: Record<string, Record<string, string>>;
  digits: DigitSystem;
  displayNumber: string;
  deskNumber: string | null;
  /** The language the visitor chose at reception. */
  ticketLanguage: string;
  recall?: boolean;
  /** The screen's device token (the admin test uses the signed-in session instead); used by the cloud voice. */
  deviceToken?: string;
  /** Preview overrides. */
  callLanguages?: CallLanguages;
  repeat?: number;
};

/** The planned steps for a call, exactly as the screen would speak them. */
export type CallInput = PlanInput & { id: string };

export function planCall(input: PlanInput): PlannedStep[] {
  const v = input.settings;
  return planAnnouncement({
    templates: input.templates,
    event: input.recall && input.templates.ticket_recalled ? "ticket_recalled" : "ticket_called",
    settings: {
      callLanguages: input.callLanguages ?? v.callLanguages,
      ticketReading: v.ticketReading,
      announceDesk: v.announceDesk,
    },
    displayNumber: input.displayNumber,
    deskNumber: input.deskNumber,
    ticketLanguage: input.ticketLanguage,
    digits: input.digits,
  });
}

/** A group call to a hall (D62): the numbers of everyone called, announced as configured for the branch. */
export type HallPlanInput = Omit<PlanInput, "displayNumber" | "deskNumber"> & {
  hallNumber: string;
  displayNumbers: string[];
  announce: { mode: AnnounceMode; maxAnnounced: number };
};
export type HallCallInput = HallPlanInput & { id: string };

export function planHallCall(input: HallPlanInput): PlannedStep[] {
  const v = input.settings;
  return planHallAnnouncement({
    settings: { callLanguages: input.callLanguages ?? v.callLanguages, ticketReading: v.ticketReading },
    hallNumber: input.hallNumber,
    displayNumbers: input.displayNumbers,
    announce: input.announce,
    ticketLanguage: input.ticketLanguage,
    digits: input.digits,
  });
}

/** The job for a group call. A recorded pack that lacks the group phrases cannot say it, so the browser voice does. */
export function buildHallVoiceJob(input: HallCallInput): VoiceJob | null {
  return jobFrom(input, planHallCall(input));
}

/** The job the voice engine plays; null when nothing can be said. Used by the TV screen and the admin preview alike. */
export function buildVoiceJob(input: CallInput): VoiceJob | null {
  return jobFrom(input, planCall(input));
}

/** Fetches the mp3 of one sentence from the server (screens send their device token, the admin test its session). */
function sentenceFetcher(deviceToken?: string) {
  return async (text: string, voice: string): Promise<ArrayBuffer> => {
    const res = await fetch(`/api/v1/display/tts?${new URLSearchParams({ text, voice })}`, {
      headers: deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {},
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`speech ${res.status}`);
    return res.arrayBuffer();
  };
}

function jobFrom(
  input: { id: string; settings: VoiceSettings; packs: PlanInput["packs"]; repeat?: number; deviceToken?: string },
  steps: PlannedStep[],
): VoiceJob | null {
  const v = input.settings;
  if (!steps.length) return null;
  const browser = new BrowserTts();
  const pack = new PackTts(input.packs);
  // "cloud": the whole Arabic call is read as one sentence by a neural voice (the server renders and caches it); if that
  // is unreachable, the recorded pack and then the browser voice take over.
  const cloud = new CloudTts(sentenceFetcher(input.deviceToken), packVoiceId(input.packs.ar));
  const providers: TtsProvider[] =
    v.provider === "cloud" ? [cloud, pack, browser] : v.provider === "pack" ? [pack, browser] : [browser, pack];
  return {
    id: input.id,
    steps,
    repeat: input.repeat ?? v.repeat,
    gapMs: v.repeatGapSeconds * 1000,
    chime: v.chime,
    chimeVolume: v.chimeVolume,
    gapChimeMs: v.gapChimeMs,
    providers,
    opts: {
      rate: v.rate,
      volume: v.volume,
      speed: v.speed,
      timing: {
        gapPhraseMs: v.gapPhraseMs,
        gapLetterNumberMs: v.gapLetterNumberMs,
        gapDeskMs: v.gapDeskMs,
        overlapMs: v.overlapMs,
      },
      voiceNames: v.voiceNames,
    },
  };
}
