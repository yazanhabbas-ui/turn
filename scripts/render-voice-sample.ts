/**
 * Offline render of one announcement exactly as the screen schedules it (same composer and scheduler), written
 * to a WAV so its length and shape can be checked without a browser:
 *
 *   npx tsx scripts/render-voice-sample.ts ar-sa-hamed out.wav [B-014] [3]
 */
import fs from "node:fs";
import path from "node:path";
import { buildArabicUnits, resolveUnits, type GapKind } from "../src/domain/display/arabic-speech";
import { NATURAL_TIMING, scheduleClips } from "../src/features/display/voice/schedule";
import { decodeMp3, encodeWav } from "./lib/voice-audio.mjs";

const [id = "ar-sa-hamed", out = "sample.wav", ticket = "B-014", desk = "3"] = process.argv.slice(2);
const root = path.join(process.cwd(), "public", "audio", "ar", id);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, string>;
const plan = resolveUnits(buildArabicUnits({ ticket, desk }), (k) => !!manifest[k]);
if (!plan) throw new Error("pack cannot say this call");
const steps = plan;

async function main() {
  const clips: { key: string; gap: GapKind | null; samples: Float32Array; rate: number; duration: number }[] = [];
  for (const c of steps) {
    const { samples, rate } = await decodeMp3(fs.readFileSync(path.join(process.cwd(), "public", manifest[c.key])));
    clips.push({ key: c.key, gap: c.gap, samples, rate, duration: samples.length / rate });
  }
  const { starts, total } = scheduleClips(clips, NATURAL_TIMING);
  const rate = clips[0].rate;
  const mix = new Float32Array(Math.ceil(total * rate) + 1);
  clips.forEach((c, i) => {
    const at = Math.round(starts[i] * rate);
    for (let j = 0; j < c.samples.length; j++) mix[at + j] += c.samples[j];
  });
  fs.writeFileSync(out, encodeWav(mix, rate));
  console.log(`${id} ${ticket} desk ${desk}: ${clips.map((c) => c.key).join(" ")}`);
  console.log(
    `new length ${total.toFixed(2)} s (clips alone ${clips.reduce((s, c) => s + c.duration, 0).toFixed(2)} s) -> ${out}`,
  );
}

void main();
