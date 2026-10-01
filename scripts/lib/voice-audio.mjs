// Offline audio helpers shared by the Arabic clip scripts: mp3 decode (mpg123 WASM), mp3 encode (lamejs),
// silence trimming, loudness normalisation and measurements. No ffmpeg or sox needed.
import { Mp3Encoder } from "@breezystack/lamejs";
import { MPEGDecoder } from "mpg123-decoder";

export const CLIP_RATE = 22050;
export const CLIP_KBPS = 32;
/** Silence kept before / after the speech of every clip, in ms (the engine adds the deliberate gaps). */
export const LEAD_MS = 35;
export const TAIL_MS = 50;
/** Every clip is brought to this gated RMS level (dBFS) and never exceeds this peak (dBFS). */
export const TARGET_RMS_DB = -20;
export const PEAK_CEILING_DB = -1;
/** Below this level (dBFS, absolute) a sample counts as silence. */
export const SILENCE_DB = -46;

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const lin = (d) => Math.pow(10, d / 20);

/** Decodes an mp3 buffer into mono Float32 samples. */
export async function decodeMp3(bytes) {
  const dec = new MPEGDecoder();
  await dec.ready;
  try {
    const out = dec.decode(new Uint8Array(bytes));
    const chans = out.channelData;
    const n = out.samplesDecoded;
    const mono = new Float32Array(n);
    for (let c = 0; c < chans.length; c++) for (let i = 0; i < n; i++) mono[i] += chans[c][i] / chans.length;
    return { samples: mono, rate: out.sampleRate };
  } finally {
    dec.free();
  }
}

/** Reads a 16-bit PCM mono/stereo WAV (what Piper writes). */
export function decodeWav(buf) {
  const at = buf.indexOf("data");
  const rate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const len = buf.readUInt32LE(at + 4);
  const end = Math.min(buf.length, at + 8 + len);
  const n = Math.floor((end - at - 8) / 2 / channels);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += buf.readInt16LE(at + 8 + (i * channels + c) * 2) / 32768;
    mono[i] = s / channels;
  }
  return { samples: mono, rate };
}

/** Linear-interpolation resampler (speech at 22-24 kHz, so this is plenty). */
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * k;
    const i0 = Math.floor(p);
    const f = p - i0;
    out[i] = samples[i0] * (1 - f) + (samples[Math.min(i0 + 1, samples.length - 1)] ?? 0) * f;
  }
  return out;
}

/** First / last sample index above the silence threshold, looking at 2 ms windows (ignores clicks). */
function speechBounds(x, rate) {
  const win = Math.max(1, Math.round(rate * 0.002));
  const thr = lin(SILENCE_DB);
  const loud = (i) => {
    let m = 0;
    for (let j = i; j < Math.min(x.length, i + win); j++) m = Math.max(m, Math.abs(x[j]));
    return m > thr;
  };
  let a = 0;
  while (a < x.length && !loud(a)) a += win;
  let b = x.length - win;
  while (b > a && !loud(b)) b -= win;
  return { a, b: Math.min(x.length, b + win) };
}

/** Gated RMS in dBFS: frames within 30 dB of the loudest frame (so the silence inside a clip does not count). */
export function gatedRmsDb(x, rate) {
  const frame = Math.round(rate * 0.02);
  const ms = [];
  for (let i = 0; i + frame <= x.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += x[j] * x[j];
    ms.push(s / frame);
  }
  if (!ms.length) return -Infinity;
  const gate = Math.max(...ms) * lin(-30) ** 2;
  const kept = ms.filter((v) => v >= gate);
  return 10 * Math.log10(kept.reduce((a, b) => a + b, 0) / kept.length);
}

export function peakDb(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return db(m);
}

/** Trim to speech + LEAD/TAIL, fade the edges, bring to the common level. */
export function condition(samples, rate) {
  const x = resample(samples, rate, CLIP_RATE);
  const { a, b } = speechBounds(x, CLIP_RATE);
  const lead = Math.round((CLIP_RATE * LEAD_MS) / 1000);
  const tail = Math.round((CLIP_RATE * TAIL_MS) / 1000);
  const speech = x.subarray(a, Math.max(a + 1, b));
  const out = new Float32Array(lead + speech.length + tail);
  out.set(speech, lead);
  // 6 ms fades so a clip never clicks when placed next to another.
  const fade = Math.round(CLIP_RATE * 0.006);
  for (let i = 0; i < Math.min(fade, speech.length); i++) {
    out[lead + i] *= i / fade;
    out[lead + speech.length - 1 - i] *= i / fade;
  }
  let gain = lin(TARGET_RMS_DB - gatedRmsDb(out, CLIP_RATE));
  const peak = lin(PEAK_CEILING_DB);
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m * gain > peak) gain = peak / m;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/** Mono mp3 at CLIP_RATE / CLIP_KBPS. */
export function encodeMp3(samples) {
  const enc = new Mp3Encoder(1, CLIP_RATE, CLIP_KBPS);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  const chunks = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const c = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (c.length) chunks.push(Buffer.from(c));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

/** Objective description of a decoded clip. */
export function measure(samples, rate) {
  const { a, b } = speechBounds(samples, rate);
  return {
    durationMs: Math.round((samples.length / rate) * 1000),
    leadMs: Math.round((a / rate) * 1000),
    tailMs: Math.round(((samples.length - b) / rate) * 1000),
    peakDb: +peakDb(samples).toFixed(1),
    rmsDb: +gatedRmsDb(samples, rate).toFixed(1),
  };
}

/** 16-bit mono WAV file from samples. */
export function encodeWav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
