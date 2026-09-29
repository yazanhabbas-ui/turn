import type { SpeechOptions, SpeechStep, TtsProvider } from "./providers";

export type VoiceJob = {
  /** Same id = same call; a job that has not started yet is replaced instead of announced twice. */
  id: string;
  steps: SpeechStep[];
  repeat: number;
  gapMs: number;
  chime: boolean;
  opts: SpeechOptions;
  /** Providers in order of preference. */
  providers: TtsProvider[];
};

export type VoiceEvents = {
  onStart?: (job: VoiceJob) => void;
  onEnd?: (job: VoiceJob) => void;
  /** A step could not be spoken by any provider (no installed voice, missing clips…). */
  onUnavailable?: (step: SpeechStep) => void;
};

const MAX_QUEUE = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Two rising tones, generated with WebAudio so no audio file is needed. */
export async function playChime(ctx: AudioContext, volume: number) {
  const tone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * volume), ctx.currentTime + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
  };
  tone(880, 0, 0.45);
  tone(1174.66, 0.32, 0.7);
  await sleep(1100);
}

/**
 * Announcements are queued and spoken one at a time, never overlapping: chime first, then each language in
 * order, the whole sequence repeated N times.
 */
export class VoiceEngine {
  private queue: VoiceJob[] = [];
  private running = false;
  private active: VoiceJob | null = null;
  private ctx: AudioContext | null = null;

  constructor(private readonly events: VoiceEvents = {}) {}

  /** Creates the audio context; returns true when the browser already lets us play sound (kiosk mode). */
  init(): boolean {
    if (typeof window === "undefined") return false;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    this.ctx ??= new Ctor();
    return this.ctx.state === "running";
  }

  get unlocked() {
    return this.ctx?.state === "running";
  }

  /** Must be called from a user gesture (click / key) when the browser blocks autoplay. */
  async unlock(): Promise<boolean> {
    this.init();
    try {
      await this.ctx?.resume();
      // Prime the speech engine inside the gesture so later announcements are allowed.
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* stays locked */
    }
    return this.unlocked;
  }

  enqueue(job: VoiceJob) {
    const same = this.queue.findIndex((j) => j.id === job.id);
    if (same >= 0) this.queue[same] = job;
    else this.queue.push(job);
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    void this.run();
  }

  /** Stops the current announcement and drops everything queued. */
  clear() {
    this.queue = [];
    this.active?.providers.forEach((p) => p.stop());
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      let job: VoiceJob | undefined;
      while ((job = this.queue.shift())) {
        this.active = job;
        this.events.onStart?.(job);
        try {
          await this.play(job);
        } catch {
          /* one failed announcement must not block the queue */
        }
        this.events.onEnd?.(job);
        this.active = null;
      }
    } finally {
      this.running = false;
    }
  }

  private async play(job: VoiceJob) {
    if (job.chime && this.ctx?.state === "running") await playChime(this.ctx, job.opts.volume).catch(() => undefined);
    for (let round = 0; round < job.repeat; round++) {
      for (const step of job.steps) {
        const provider = await this.choose(job, step);
        if (!provider) {
          this.events.onUnavailable?.(step);
          continue;
        }
        try {
          await provider.speak(step, job.opts);
        } catch {
          this.events.onUnavailable?.(step);
        }
      }
      if (round < job.repeat - 1) await sleep(job.gapMs);
    }
  }

  private async choose(job: VoiceJob, step: SpeechStep) {
    for (const p of job.providers) if (await p.supports(step)) return p;
    return null;
  }
}
