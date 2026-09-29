import { LOCALES, type Locale } from "@/i18n/locales";

/** What a provider needs to speak one phrase. `keys` are the clip keys a pre-recorded pack would play. */
export type SpeechStep = { locale: string; text: string; keys: string[] };
export type SpeechOptions = { rate: number; volume: number; voiceName?: string };

/**
 * Pluggable text-to-speech. The engine tries providers in the configured order and uses the first one that
 * `supports` the step. To add a cloud TTS (Azure, Google, ElevenLabs…): implement this interface so that `speak`
 * fetches audio from a server endpoint that holds the API key, plays it, and resolve when playback ends.
 */
export interface TtsProvider {
  readonly id: "browser" | "pack" | "cloud";
  supports(step: SpeechStep): Promise<boolean> | boolean;
  speak(step: SpeechStep, opts: SpeechOptions): Promise<void>;
  stop(): void;
}

function voicesReady(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

/** Picks the best installed voice for a locale: the preferred name first, then the region variants in order. */
export function pickVoice(voices: SpeechSynthesisVoice[], locale: string, preferredName?: string): SpeechSynthesisVoice | null {
  const langs = (LOCALES[locale as Locale]?.speech ?? [locale]) as readonly string[];
  const base = locale.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base));
  if (!matching.length) return null;
  if (preferredName) {
    const named = matching.find((v) => v.name.toLowerCase().startsWith(preferredName.toLowerCase()));
    if (named) return named;
  }
  for (const l of langs) {
    const v = matching.find((m) => m.lang.toLowerCase().replace("_", "-") === l.toLowerCase());
    if (v) return v;
  }
  return matching[0];
}

/** The screen's own speech engine (Web Speech API). Many kiosk PCs have no Arabic voice, hence `supports`. */
export class BrowserTts implements TtsProvider {
  readonly id = "browser" as const;

  async supports(step: SpeechStep) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    return !!pickVoice(await voicesReady(), step.locale);
  }

  async speak(step: SpeechStep, opts: SpeechOptions) {
    const synth = window.speechSynthesis;
    const voice = pickVoice(await voicesReady(), step.locale, opts.voiceName);
    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(step.text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = LOCALES[step.locale as Locale]?.speech[0] ?? step.locale;
      }
      u.rate = opts.rate;
      u.volume = opts.volume;
      // Some engines never fire `end` (e.g. when the tab is throttled); do not block the queue forever.
      const guard = setTimeout(resolve, 3000 + step.text.length * 180);
      u.onend = () => {
        clearTimeout(guard);
        resolve();
      };
      u.onerror = (e) => {
        clearTimeout(guard);
        // "canceled"/"interrupted" are our own stop() calls, not failures.
        if (e.error === "canceled" || e.error === "interrupted") resolve();
        else reject(new Error(e.error));
      };
      synth.speak(u);
    });
  }

  stop() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

/** Plays pre-recorded clips (digits, letters, phrases) in sequence; for kiosks with no Arabic voice at all. */
export class PackTts implements TtsProvider {
  readonly id = "pack" as const;
  private current: HTMLAudioElement | null = null;
  private stopped = false;

  constructor(private readonly packs: Record<string, Record<string, string>>) {}

  supports(step: SpeechStep) {
    const manifest = this.packs[step.locale];
    return !!manifest && step.keys.length > 0 && step.keys.every((k) => !!manifest[k]);
  }

  async speak(step: SpeechStep, opts: SpeechOptions) {
    const manifest = this.packs[step.locale];
    this.stopped = false;
    for (const key of step.keys) {
      if (this.stopped) return;
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(manifest[key]);
        audio.volume = opts.volume;
        audio.playbackRate = Math.min(1.5, Math.max(0.5, opts.rate / 0.9));
        this.current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error(`clip ${key} failed`));
        audio.play().catch(reject);
      });
    }
  }

  stop() {
    this.stopped = true;
    this.current?.pause();
    this.current = null;
  }
}
