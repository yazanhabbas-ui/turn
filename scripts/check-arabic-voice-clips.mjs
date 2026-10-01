// Objective quality gate for the bundled Arabic clips (nobody has to listen to find a broken clip).
//
//   node scripts/check-arabic-voice-clips.mjs [voice-id ...]
//
// For every clip: duration, peak, gated RMS, silence before / after the speech. Fails (exit 1) when a clip is
// outside the thresholds the generator guarantees.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMp3, measure } from "./lib/voice-audio.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio", "ar");
const LIMITS = { leadMs: [40, 150], tailMs: [20, 260], peakDb: [-30, -0.1], rmsDb: [-23, -18], durationMs: [150, 6000] };
const wanted = process.argv.slice(2);
const ids = fs
  .readdirSync(OUT, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() && fs.existsSync(path.join(OUT, d.name, "manifest.json")) && (!wanted.length || wanted.includes(d.name)),
  )
  .map((d) => d.name);

let bad = 0;
for (const id of ids) {
  const files = fs.readdirSync(path.join(OUT, id)).filter((f) => f.endsWith(".mp3"));
  const rows = [];
  for (const f of files) {
    const { samples, rate } = await decodeMp3(fs.readFileSync(path.join(OUT, id, f)));
    rows.push({ f, ...measure(samples, rate) });
  }
  const fails = rows.flatMap((r) =>
    Object.entries(LIMITS)
      .filter(([k, [lo, hi]]) => r[k] < lo || r[k] > hi)
      .map(([k]) => `${r.f} ${k}=${r[k]}`),
  );
  const stat = (k) => {
    const v = rows.map((r) => r[k]);
    return `${Math.min(...v)}..${Math.max(...v)}`;
  };
  const bytes = files.reduce((s, f) => s + fs.statSync(path.join(OUT, id, f)).size, 0);
  console.log(
    `${id}: ${rows.length} clips, ${(bytes / 1e6).toFixed(1)} MB | duration ${stat("durationMs")} ms | lead ${stat("leadMs")} | tail ${stat("tailMs")} | peak ${stat("peakDb")} dB | rms ${stat("rmsDb")} dB | ${fails.length} outside limits`,
  );
  for (const x of fails.slice(0, 10)) console.log("   ", x);
  bad += fails.length;
}
if (bad) process.exitCode = 1;
