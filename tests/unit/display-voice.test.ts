import { describe, expect, it } from "vitest";
import { parseDisplayConfig } from "@/domain/display/config";
import { planAnnouncement } from "@/domain/display/plan";
import { announcementText, packClipKeys, speechLanguages, splitTicket, spokenTicket } from "@/domain/display/speech";
import { pickVoice } from "@/features/display/voice/providers";
import { VoiceEngine, type VoiceJob } from "@/features/display/voice/engine";
import type { TtsProvider } from "@/features/display/voice/providers";

describe("ticket numbers for speech", () => {
  it("splits Latin, Arabic-letter and Eastern-digit numbers", () => {
    expect(splitTicket("A-014")).toEqual({ prefix: "A", number: 14 });
    expect(splitTicket("أ-٠١٤")).toEqual({ prefix: "أ", number: 14 });
    expect(splitTicket("B7")).toEqual({ prefix: "B", number: 7 });
    expect(splitTicket("042")).toEqual({ prefix: "", number: 42 });
  });

  it("speaks the number without leading zeros, in the voice digit system", () => {
    expect(spokenTicket("A-014", "latn")).toBe("A 14");
    expect(spokenTicket("A-014", "arab")).toBe("A ١٤");
    expect(spokenTicket("أ-٠٠٥", "arab")).toBe("أ ٥");
    expect(spokenTicket("GA-100", "latn")).toBe("G A 100");
  });
});

describe("announcement templates", () => {
  it("fills {ticket} and {desk} and leaves unknown placeholders visible", () => {
    const text = announcementText("رقم {ticket}، الرجاء التوجه إلى المكتب {desk} {x}", { ticket: "A-014", desk: "3" }, "arab");
    expect(text).toBe("رقم A ١٤، الرجاء التوجه إلى المكتب ٣ {x}");
  });

  it("chooses languages: the sequence, or only the visitor's language", () => {
    expect(speechLanguages("sequence", ["ar", "en"], "en")).toEqual(["ar", "en"]);
    expect(speechLanguages("ticket", ["ar", "en"], "en")).toEqual(["en"]);
    expect(speechLanguages("sequence", [], "ar")).toEqual(["ar"]);
  });

  it("plans one step per language from the editable templates, skipping missing ones", () => {
    const templates = { ticket_called: { ar: "رقم {ticket} إلى المكتب {desk}", en: "Number {ticket}, desk {desk}" } };
    const base = {
      templates,
      event: "ticket_called" as const,
      displayNumber: "A-014",
      deskNumber: "3",
      ticketLanguage: "en",
      digits: "latn" as const,
    };
    const both = planAnnouncement({ ...base, settings: { mode: "sequence", languages: ["ar", "en"] } });
    expect(both.map((s) => s.locale)).toEqual(["ar", "en"]);
    expect(both[1].text).toBe("Number A 14, desk 3");
    expect(planAnnouncement({ ...base, settings: { mode: "ticket", languages: ["ar", "en"] } }).map((s) => s.locale)).toEqual([
      "en",
    ]);
    const onlyEn = planAnnouncement({
      ...base,
      templates: { ticket_called: { en: "x" } },
      settings: { mode: "sequence", languages: ["ar", "en"] },
    });
    expect(onlyEn.map((s) => s.locale)).toEqual(["en"]);
    // A recall without its own template reuses the call template.
    expect(planAnnouncement({ ...base, event: "ticket_recalled", settings: { mode: "ticket", languages: ["en"] } })).toHaveLength(
      1,
    );
  });

  it("builds the clip list of a pre-recorded pack", () => {
    expect(packClipKeys("A-014", "3", "ar")).toEqual([
      "ar.phrase.number",
      "ar.letter.A",
      "ar.digit.1",
      "ar.digit.4",
      "ar.phrase.desk",
      "ar.digit.3",
    ]);
  });
});

describe("screen configuration", () => {
  it("fills defaults and falls back on garbage", () => {
    const c = parseDisplayConfig({});
    expect(c.languages).toEqual(["ar", "en"]);
    expect(c.showTicker).toBe(true);
    expect(parseDisplayConfig({ rotateSeconds: 1 }).rotateSeconds).toBe(15);
    expect(parseDisplayConfig("nonsense").zones).toEqual([]);
  });
});

describe("voice selection", () => {
  const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
  const voices = [v("Google US", "en-US"), v("Hoda", "ar-EG"), v("Naayf", "ar-SA"), v("Zira", "en-GB")];
  it("prefers the named voice, then ar-SA, and returns null when the language is missing", () => {
    expect(pickVoice(voices, "ar")?.name).toBe("Naayf");
    expect(pickVoice(voices, "ar", "hoda")?.name).toBe("Hoda");
    expect(pickVoice(voices, "en")?.name).toBe("Google US");
    expect(pickVoice([v("Zira", "en-GB")], "ar")).toBeNull();
  });
});

describe("voice queue", () => {
  it("speaks announcements one at a time, in order, repeated, and never overlaps", async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const provider: TtsProvider = {
      id: "browser",
      supports: (s) => s.locale !== "xx",
      speak: async (s) => {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`${s.locale}:${s.text}`);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      stop: () => undefined,
    };
    const unavailable: string[] = [];
    const engine = new VoiceEngine({ onUnavailable: (s) => unavailable.push(s.locale) });
    const job = (id: string, text: string): VoiceJob => ({
      id,
      steps: [
        { locale: "ar", text: `${text}-ar`, keys: [] },
        { locale: "xx", text: "skipped", keys: [] },
        { locale: "en", text: `${text}-en`, keys: [] },
      ],
      repeat: 2,
      gapMs: 1,
      chime: false,
      opts: { rate: 1, volume: 1 },
      providers: [provider],
    });
    engine.enqueue(job("1", "a"));
    engine.enqueue(job("2", "b"));
    await new Promise((r) => setTimeout(r, 200));
    expect(maxActive).toBe(1);
    expect(log).toEqual(["ar:a-ar", "en:a-en", "ar:a-ar", "en:a-en", "ar:b-ar", "en:b-en", "ar:b-ar", "en:b-en"]);
    expect(unavailable).toEqual(["xx", "xx", "xx", "xx"]);
  });
});
