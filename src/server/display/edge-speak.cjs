/* eslint-disable @typescript-eslint/no-require-imports */
// Renders one sentence with a neural voice and writes the mp3 to stdout.
//   node edge-speak.cjs <voice> <rate>      (the text arrives on stdin, UTF-8)
// It runs in its own process, started by src/server/display/tts.ts, so the app's bundler and runtime never touch the
// speech library (bundled WebSocket code breaks inside Next.js).
const { Communicate } = require("edge-tts-universal");

const [voice, rate] = process.argv.slice(2);
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    const audio = [];
    for await (const ch of new Communicate(text, { voice, rate }).stream()) {
      if (ch.type === "audio" && ch.data) audio.push(Buffer.from(ch.data));
    }
    process.stdout.write(Buffer.concat(audio));
  } catch (e) {
    process.stderr.write(String((e && e.message) || e));
    process.exitCode = 1;
  }
});
