import type { GapKind } from "@/domain/display/arabic-speech";

/** Deliberate pauses of a recorded announcement, in milliseconds (from the `voice` setting). */
export type Timing = {
  gapPhraseMs: number;
  gapLetterNumberMs: number;
  gapDeskMs: number;
  overlapMs: number;
};

/** The natural defaults; the same numbers as the `voice` setting defaults. */
export const NATURAL_TIMING: Timing = { gapPhraseMs: 180, gapLetterNumberMs: 120, gapDeskMs: 350, overlapMs: 0 };

/** Silence before / after the speech of a generated clip once decoded (seconds): the 35 / 50 ms the generator keeps plus the mp3 encoder delay (measured by check-arabic-voice-clips). */
export const CLIP_LEAD_S = 0.085;
export const CLIP_TAIL_S = 0.08;

export function gapFor(kind: GapKind | null, timing: Timing): number {
  switch (kind) {
    case "phrase":
      return timing.gapPhraseMs;
    case "letter":
      return timing.gapLetterNumberMs;
    case "desk":
      return timing.gapDeskMs;
    default:
      return 0;
  }
}

/**
 * Start time (seconds from the beginning) of every clip and the total length. The pause between the end of one
 * voice and the start of the next is the configured one: the small fixed padding every generated clip carries is
 * subtracted first. `overlapMs` lets clips of one number ("inner" joints)
 * start slightly before the previous one ends. Clips play at `speed` (their duration shrinks accordingly).
 */
export function scheduleClips(
  clips: { gap: GapKind | null; duration: number }[],
  timing: Timing,
  speed = 1,
): { starts: number[]; total: number } {
  const starts: number[] = [];
  let end = 0;
  let prevStart = 0;
  clips.forEach((c, i) => {
    const gap = i === 0 ? 0 : gapFor(c.gap, timing) / 1000;
    const overlap = i > 0 && c.gap === "inner" ? timing.overlapMs / 1000 : 0;
    const start = i === 0 ? 0 : Math.max(prevStart, end - CLIP_TAIL_S + gap - CLIP_LEAD_S - overlap);
    starts.push(start);
    prevStart = start;
    end = start + c.duration / speed;
  });
  return { starts, total: end };
}
