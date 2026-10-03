import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_EDGE_VOICE_ID, EDGE_VOICES } from "@/domain/display/edge-voices";
import { AppError } from "../http/errors";
import { logger } from "../logger";

export const TTS_MAX_CHARS = 300;
/** Slightly slower than the default reads more clearly on a waiting-room speaker (same as the clip packs). */
const RATE = "-5%";
const dir = () => process.env.TTS_CACHE_DIR || path.join(os.tmpdir(), "dor-tts");
const inflight = new Map<string, Promise<Buffer>>();

/** Runs the speech library in its own Node process (see edge-speak.cjs) and returns the mp3 it prints. */
function renderOnce(text: string, voice: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "src", "server", "display", "edge-speak.cjs");
    const child = spawn(process.execPath, [script, voice, RATE], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (buf.length < 1200) reject(new Error(err.trim() || "empty audio"));
      else resolve(buf);
    });
    child.stdin.end(text, "utf8");
  });
}

async function synthesize(text: string, voice: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await renderOnce(text, voice);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

/**
 * One announcement as a single mp3, read as a whole sentence by a neural voice. Results are cached on disk by
 * (voice, text), so each distinct call is synthesised once and later calls (and repeats) play instantly.
 * Needs internet access the first time a sentence is requested.
 */
export async function speechAudio(text: string, voiceId: string): Promise<Buffer> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > TTS_MAX_CHARS) throw new AppError("validation", { field: "text" });
  const voice = EDGE_VOICES[voiceId] ?? EDGE_VOICES[DEFAULT_EDGE_VOICE_ID];
  const key = createHash("sha256").update(`${voice}\n${RATE}\n${clean}`).digest("hex");
  const file = path.join(dir(), `${key}.mp3`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const audio = await synthesize(clean, voice);
        await mkdir(dir(), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, audio);
        await rename(tmp, file);
        return audio;
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "speech synthesis failed");
        throw new AppError("server_error", { reason: "tts_unavailable" }, 502);
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return p;
}
