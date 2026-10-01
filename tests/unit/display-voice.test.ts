import { describe, expect, it } from "vitest";
import { parseDisplayConfig } from "@/domain/display/config";
import { planAnnouncement } from "@/domain/display/plan";
import { announcementText, callSequence, splitTicket, spokenTicket } from "@/domain/display/speech";
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

const SETTINGS_BOTH = { callLanguages: "both_ar_en" as const, ticketReading: "letter_then_number" as const, announceDesk: true };

describe("announcement templates", () => {
  it("fills {ticket} and {desk} and leaves unknown placeholders visible", () => {
    const text = announcementText("رقم {ticket}، الرجاء التوجه إلى المكتب {desk} {x}", { ticket: "A-014", desk: "3" }, "arab");
    expect(text).toBe("رقم A ١٤، الرجاء التوجه إلى المكتب ٣ {x}");
  });

  it("chooses the languages of the call", () => {
    expect(callSequence("ar", "en")).toEqual(["ar"]);
    expect(callSequence("en", "ar")).toEqual(["en"]);
    expect(callSequence("ticket", "en")).toEqual(["en"]);
    expect(callSequence("both_ar_en", "en")).toEqual(["ar", "en"]);
    expect(callSequence("both_en_ar", "ar")).toEqual(["en", "ar"]);
  });

  it("reads the ticket according to the reading mode", () => {
    expect(spokenTicket("A-014", "latn", "number_only")).toBe("14");
    expect(spokenTicket("A-114", "latn", "digits")).toBe("A 1 1 4");
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
    const both = planAnnouncement({ ...base, settings: SETTINGS_BOTH });
    expect(both.map((s) => s.locale)).toEqual(["ar", "en"]);
    expect(both[1].text).toBe("Number A 14, desk 3");
    expect(planAnnouncement({ ...base, settings: { ...SETTINGS_BOTH, callLanguages: "ticket" } }).map((s) => s.locale)).toEqual([
      "en",
    ]);
    const onlyEn = planAnnouncement({
      ...base,
      templates: { ticket_called: { en: "x" } },
      settings: SETTINGS_BOTH,
    });
    expect(onlyEn.map((s) => s.locale)).toEqual(["en"]);
    // A recall without its own template reuses the call template.
    expect(
      planAnnouncement({ ...base, event: "ticket_recalled", settings: { ...SETTINGS_BOTH, callLanguages: "ticket" } }),
    ).toHaveLength(1);
  });
});

describe("screen configuration", () => {
  it("fills defaults and falls back on garbage", () => {
    const c = parseDisplayConfig({});
    expect(c.languages).toEqual(["ar", "en"]);
    expect(c.voice).toEqual({});
    expect(parseDisplayConfig({ voice: { callLanguages: "ticket", repeat: 3 } }).voice).toEqual({
      callLanguages: "ticket",
      repeat: 3,
    });
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

describe("voice queue cancellation", () => {
  it("clear() ends the running announcement at once so a new one can start", async () => {
    const log: string[] = [];
    const provider: TtsProvider = {
      id: "browser",
      supports: () => true,
      speak: async (s) => {
        log.push(s.text);
        await new Promise((r) => setTimeout(r, 15));
      },
      stop: () => undefined,
    };
    const engine = new VoiceEngine();
    const job = (id: string): VoiceJob => ({
      id,
      steps: [1, 2, 3].map((n) => ({ locale: "ar", text: `${id}${n}`, keys: [] })),
      repeat: 3,
      gapMs: 5000,
      chime: false,
      opts: { rate: 1, volume: 1 },
      providers: [provider],
    });
    engine.enqueue(job("a"));
    await new Promise((r) => setTimeout(r, 20));
    engine.clear();
    engine.enqueue(job("b"));
    await new Promise((r) => setTimeout(r, 300));
    // "a" got at most its first two steps; the 5 s repeat pause did not hold "b" back.
    expect(log.filter((x) => x.startsWith("a")).length).toBeLessThanOrEqual(2);
    expect(log.filter((x) => x.startsWith("b")).length).toBeGreaterThanOrEqual(3);
  });
});
