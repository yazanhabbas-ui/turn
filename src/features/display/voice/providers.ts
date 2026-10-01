import { resolveUnits, type GapKind, type SpeechUnit } from "@/domain/display/arabic-speech";
import { LOCALES, type Locale } from "@/i18n/locales";
import { gapFor, NATURAL_TIMING, scheduleClips, type Timing } from "./schedule";

/**
 * What a provider needs to speak one phrase. `text` is for speech engines; a pre-recorded pack plays `units`
 * (natural Arabic numbers with their fallbacks) or, for older callers, the plain clip list `keys`.
 */
export type SpeechStep = { locale: string; text: string; keys: string[]; units?: SpeechUnit[] };
export type SpeechOptions = {
  /** Speed of the browser voice. */
  rate: number;
  volume: number;
  voiceName?: string;
  /** Preferred installed voice per language (prefix match). */
  voiceNames?: Record<string, string | undefined>;
  /** Speed of recorded clips (a small range: it shifts the pitch a little). */
  speed?: number;
  /** Pauses between the parts of a recorded announcement. */
  timing?: Timing;
};

/**
 * Pluggable text-to-speech. The engine tries providers in the configured order and uses the first one that
 * `supports` the step. To add a cloud TTS (Azure, Google, ElevenLabs…): implement this interface so that `speak`
 * fetches audio from a server endpoint that holds the API key, plays it, and resolve when playback ends.
 */
export interface TtsProvider {
  readonly id: "browser" | "pack" | "cloud";
  /** Called by the engine before speaking, with the audio context that the user unlocked. */
  attach?(ctx: AudioContext): void;
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
    const voice = pickVoice(await voicesReady(), step.locale, opts.voiceNames?.[step.locale] || opts.voiceName);
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

type Manifest = Record<string, string>;
type PlannedClip = { key: string; gap: GapKind | null };

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
const decodedCache = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer>>>();

function fetchBytes(url: string): Promise<ArrayBuffer> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`clip ${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytesCache.delete(url));
    bytesCache.set(url, p);
  }
  return p;
}

/** A clip decoded once per audio context, so a call never waits for decoding after the first time. */
function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let map = decodedCache.get(ctx);
  if (!map) decodedCache.set(ctx, (map = new Map()));
  let p = map.get(url);
  if (!p) {
    p = fetchBytes(url).then((b) => ctx.decodeAudioData(b.slice(0)));
    const cache = map;
    p.catch(() => cache.delete(url));
    map.set(url, p);
  }
  return p;
}

/** Keys decoded ahead of time: phrases, letters, digits and the numbers a queue normally reaches. */
export function priorityKeys(manifest: Manifest): string[] {
  return Object.keys(manifest).filter((k) => {
    const m = /^ar\.num\.(\d+)$/.exec(k);
    if (m) return Number(m[1]) <= 199 || Number(m[1]) % 100 === 0;
    return true;
  });
}

/**
 * Loads a pack so the first call has no latency: the common clips are decoded, the rest (the long tail of numbers)
 * is downloaded and decoded on first use. Safe to call repeatedly; resolves when everything has been requested.
 */
export async function preloadPack(ctx: AudioContext, manifest: Manifest): Promise<void> {
  const priority = new Set(priorityKeys(manifest));
  const queue = Object.entries(manifest).sort(([a], [b]) => Number(priority.has(b)) - Number(priority.has(a)));
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const [key, url] = queue[next++];
      try {
        if (priority.has(key)) await loadBuffer(ctx, url);
        else await fetchBytes(url);
      } catch {
        /* a missing clip is reported when it is needed */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

/**
 * Plays pre-recorded clips (natural Arabic numbers, letters, phrases). With an unlocked audio context the clips are
 * decoded and scheduled sample-accurately with the configured gaps, so the call sounds like one sentence; without
 * one it falls back to playing the clips one after the other.
 */
export class PackTts implements TtsProvider {
  readonly id = "pack" as const;
  private ctx: AudioContext | null = null;
  private current: HTMLAudioElement | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private finish: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly packs: Record<string, Manifest>) {}

  attach(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** The clips (with the pause before each) that would be played, or null when the pack cannot say this step. */
  plan(step: SpeechStep): PlannedClip[] | null {
    const manifest = this.packs[step.locale];
    if (!manifest) return null;
    if (step.units?.length) return resolveUnits(step.units, (k) => !!manifest[k]);
    if (!step.keys.length || !step.keys.every((k) => !!manifest[k])) return null;
    return step.keys.map((key) => ({ key, gap: "letter" as const }));
  }

  supports(step: SpeechStep) {
    return !!this.plan(step);
  }

  async speak(step: SpeechStep, opts: SpeechOptions) {
    const plan = this.plan(step);
    const manifest = this.packs[step.locale];
    if (!plan || !manifest) throw new Error("pack cannot speak this step");
    this.stopped = false;
    const timing = opts.timing ?? NATURAL_TIMING;
    const speed = Math.min(1.25, Math.max(0.8, opts.speed ?? 1));
    const ctx = this.ctx;
    if (ctx && ctx.state === "running") await this.playScheduled(ctx, plan, manifest, opts.volume, timing, speed);
    else await this.playSequential(plan, manifest, opts.volume, timing, speed);
  }

  private async playScheduled(
    ctx: AudioContext,
    plan: PlannedClip[],
    manifest: Manifest,
    volume: number,
    timing: Timing,
    speed: number,
  ) {
    const buffers = await Promise.all(plan.map((c) => loadBuffer(ctx, manifest[c.key])));
    if (this.stopped) return;
    const { starts, total } = scheduleClips(
      plan.map((c, i) => ({ gap: c.gap, duration: buffers[i].duration })),
      timing,
      speed,
    );
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    this.sources = buffers.map((buffer, i) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = speed;
      src.connect(master);
      src.start(t0 + starts[i]);
      return src;
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, (t0 + total - ctx.currentTime) * 1000 + 40);
      this.finish = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.finish = null;
    this.sources = [];
    master.disconnect();
  }

  private async playSequential(plan: PlannedClip[], manifest: Manifest, volume: number, timing: Timing, speed: number) {
    for (const [i, clip] of plan.entries()) {
      if (this.stopped) return;
      if (i > 0) await new Promise((r) => setTimeout(r, gapFor(clip.gap, timing)));
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(manifest[clip.key]);
        audio.volume = volume;
        audio.playbackRate = speed;
        this.current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error(`clip ${clip.key} failed`));
        audio.play().catch(reject);
      });
    }
  }

  stop() {
    this.stopped = true;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started yet */
      }
    }
    this.sources = [];
    this.finish?.();
    this.current?.pause();
    this.current = null;
  }
}
