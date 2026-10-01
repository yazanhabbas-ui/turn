// Generates the bundled Arabic announcement packs in public/audio/ar/<voice-id>/.
//
//   node scripts/build-arabic-voice-clips.mjs                     # every voice in catalog.json (Edge + Piper)
//   node scripts/build-arabic-voice-clips.mjs ar-sa-hamed         # only some voice ids
//   node scripts/build-arabic-voice-clips.mjs --only=numbers      # numbers | letters | phrases
//   node scripts/build-arabic-voice-clips.mjs --refresh           # ignore the raw cache and synthesise again
//
// What is produced per voice: whole-number clips 0..999 and the thousands (num-N.mp3), the Latin and Arabic
// letters, the fixed phrases ("رقم", "تفضل إلى المكتب") and manifest.json (clip key -> public URL). Words come from
// src/domain/display/arabic-words.ts, the same file the announcement composer uses.
//
// Every clip is trimmed to ~35 ms of lead / ~50 ms of tail silence and loudness-normalised (see lib/voice-audio.mjs),
// then written as mono 22.05 kHz / 32 kbps mp3. Raw synthesis results are cached in node_modules/.cache/voice-clips so
// re-running only re-processes.
//
// Sources: Microsoft neural voices through the unofficial Edge read-aloud service (evaluation only, see D35/D54:
// regenerate with an Azure Speech key or record your own clips before shipping) and the offline Piper model
// (PIPER_DIR = folder with piper/piper.exe, ar.onnx).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Communicate } from "edge-tts-universal";
import {
  ARABIC_LATIN_LETTERS,
  ARABIC_LETTER_NAMES,
  ARABIC_PHRASES,
  ARABIC_THOUSAND,
  ARABIC_THOUSANDS,
  arabicNumberWords,
} from "../src/domain/display/arabic-words.ts";
import { condition, decodeMp3, decodeWav, encodeMp3 } from "./lib/voice-audio.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "audio", "ar");
const CACHE = path.join(ROOT, "node_modules", ".cache", "voice-clips");
const PIPER_DIR = process.env.PIPER_DIR ?? path.join(ROOT, ".local", "piper");
const EDGE_NAMES = {
  "ar-sy-laith": "ar-SY-LaithNeural",
  "ar-sy-amany": "ar-SY-AmanyNeural",
  "ar-sa-zariyah": "ar-SA-ZariyahNeural",
  "ar-sa-hamed": "ar-SA-HamedNeural",
  "ar-ae-hamdan": "ar-AE-HamdanNeural",
  "ar-kw-fahed": "ar-KW-FahedNeural",
  "ar-lb-rami": "ar-LB-RamiNeural",
  "ar-dz-ismael": "ar-DZ-IsmaelNeural",
  "ar-ma-jamal": "ar-MA-JamalNeural",
};
/** Slightly slower than default reads more clearly on a waiting-room speaker. */
const EDGE_RATE = "-5%";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = flag("only");
const refresh = args.includes("--refresh");
const concurrency = Number(flag("concurrency") ?? 4);
const catalog = JSON.parse(fs.readFileSync(path.join(OUT, "catalog.json"), "utf8"));
const wanted = args.filter((a) => !a.startsWith("--"));
const voices = catalog.filter((v) => !wanted.length || wanted.includes(v.id));

const fileOfLetter = (ch) => (/^[A-Za-z]$/.test(ch) ? `letter-${ch.toUpperCase()}` : `letter-u${ch.codePointAt(0).toString(16)}`);

/** [manifest key, file name without extension, text, group] */
function allClips() {
  const list = [];
  list.push(["ar.phrase.number", "phrase-number", ARABIC_PHRASES.number, "phrases"]);
  list.push(["ar.phrase.desk", "phrase-desk", ARABIC_PHRASES.desk, "phrases"]);
  for (let n = 0; n <= 999; n++) list.push([`ar.num.${n}`, `num-${n}`, arabicNumberWords(n), "numbers"]);
  for (const t of Object.keys(ARABIC_THOUSANDS))
    list.push([`ar.num.${Number(t) * 1000}`, `num-${Number(t) * 1000}`, ARABIC_THOUSANDS[t], "numbers"]);
  list.push(["ar.word.thousand", "word-thousand", ARABIC_THOUSAND, "numbers"]);
  for (const [ch, text] of Object.entries(ARABIC_LATIN_LETTERS))
    list.push([`ar.letter.${ch}`, fileOfLetter(ch), text, "letters"]);
  for (const [ch, text] of Object.entries(ARABIC_LETTER_NAMES)) list.push([`ar.letter.${ch}`, fileOfLetter(ch), text, "letters"]);
  return list;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synthEdge(text, voice) {
  for (let attempt = 0; ; attempt++) {
    try {
      const chunks = [];
      for await (const ch of new Communicate(text, { voice, rate: EDGE_RATE }).stream())
        if (ch.type === "audio" && ch.data) chunks.push(Buffer.from(ch.data));
      const buf = Buffer.concat(chunks);
      if (buf.length < 1200) throw new Error("empty audio");
      return buf;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

function synthPiper(text) {
  const exe = path.join(PIPER_DIR, "piper", "piper.exe");
  if (!fs.existsSync(exe)) throw new Error(`Piper not found at ${exe} (set PIPER_DIR)`);
  const tmp = path.join(CACHE, `piper-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  const r = spawnSync(exe, ["-m", path.join(PIPER_DIR, "ar.onnx"), "-f", tmp], {
    input: Buffer.from(text + "\n", "utf8"),
    cwd: PIPER_DIR,
  });
  if (r.status !== 0) throw new Error(`piper: ${r.stderr}`);
  const wav = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return wav;
}

async function rawClip(voice, file, text) {
  const isPiper = voice.engine === "Piper";
  const cached = path.join(CACHE, voice.id, `${file}.${isPiper ? "wav" : "mp3"}`);
  if (!refresh && fs.existsSync(cached)) return fs.readFileSync(cached);
  const bytes = isPiper ? synthPiper(text) : await synthEdge(text, EDGE_NAMES[voice.id]);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, bytes);
  return bytes;
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

fs.mkdirSync(CACHE, { recursive: true });
/**
 * Voices marked "numbers": "full" in catalog.json get every whole number 0..999 (about 8 MB). The others get the
 * "core" set: 0..100, the hundreds and the thousands, which is enough to compose any number naturally from
 * two or three clips (the composer falls back to these pieces; see arabic-speech.ts).
 */
const inCoreSet = (key) => {
  const m = /^ar\.num\.(\d+)$/.exec(key);
  return !m || Number(m[1]) <= 100 || Number(m[1]) % 100 === 0;
};
const everyClipOf = (voice) =>
  allClips().filter(([key]) => voice.numbers === "full" || args.includes("--full") || inCoreSet(key));
for (const voice of voices) {
  const everyClip = everyClipOf(voice);
  const clips = everyClip.filter((c) => !only || c[3] === only);
  if (voice.engine !== "Piper" && !EDGE_NAMES[voice.id]) {
    console.log(`skip ${voice.id}: no synthesiser configured`);
    continue;
  }
  const dir = path.join(OUT, voice.id);
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;
  const failed = [];
  const t0 = Date.now();
  await pool(clips, voice.engine === "Piper" ? 2 : concurrency, async ([key, file, text]) => {
    try {
      const raw = await rawClip(voice, file, text);
      const { samples, rate } = voice.engine === "Piper" ? decodeWav(raw) : await decodeMp3(raw);
      fs.writeFileSync(path.join(dir, `${file}.mp3`), encodeMp3(condition(samples, rate)));
    } catch (e) {
      failed.push(`${key}: ${String(e).slice(0, 80)}`);
    }
    if (++done % 100 === 0) console.log(`${voice.id} ${done}/${clips.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  });

  // The manifest always lists every clip that exists in the folder (so partial --only runs keep the rest).
  const manifest = {};
  for (const [key, file] of everyClip)
    if (fs.existsSync(path.join(dir, `${file}.mp3`))) manifest[key] = `/audio/ar/${voice.id}/${file}.mp3`;
  // The digit clips (legacy "digits" reading) are the number clips 0..9.
  for (let d = 0; d <= 9; d++) if (manifest[`ar.num.${d}`]) manifest[`ar.digit.${d}`] = manifest[`ar.num.${d}`];
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Remove files of the earlier 66-clip layout that the manifest no longer references.
  const used = new Set(Object.values(manifest).map((u) => path.basename(u)));
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".mp3") && !used.has(f)) fs.unlinkSync(path.join(dir, f));
  const bytes = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
  console.log(
    `${voice.id}: ${Object.keys(manifest).length} manifest entries, ${(bytes / 1e6).toFixed(1)} MB, ${failed.length} failed`,
  );
  for (const f of failed) console.log("  FAILED", f);
}
