/**
 * The neural voice behind each bundled Arabic pack. The same voice reads whole announcements as one sentence
 * (provider "cloud"), so the call sounds like a person speaking, not like clips joined together.
 * No imports on purpose: the clip generator and the server both read these names.
 */
export const EDGE_VOICES: Readonly<Record<string, string>> = {
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

/** Used when the active pack has no neural counterpart (for example the offline Piper voice). */
export const DEFAULT_EDGE_VOICE_ID = "ar-sa-hamed";

/** The voice id of a pack, read from the URLs of its manifest (`/audio/ar/<id>/phrase-number.mp3`). */
export function packVoiceId(manifest: Record<string, string> | undefined): string {
  for (const url of Object.values(manifest ?? {})) {
    const m = /\/audio\/ar\/([a-z0-9-]+)\//.exec(url);
    if (m && EDGE_VOICES[m[1]]) return m[1];
  }
  return DEFAULT_EDGE_VOICE_ID;
}
