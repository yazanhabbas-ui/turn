import { describe, expect, it } from "vitest";
import { callCodeWords, planAnnouncement } from "@/domain/display/plan";
import { callCodeOf, nextCyclicNumber, nextNumber } from "@/domain/tickets/numbering";

describe("numbers that restart during the day", () => {
  const range = { start: 1, end: 100 };

  it("counts on like before while the limit is off", () => {
    expect(nextCyclicNumber(0, 0, range, { wrap: false })).toEqual({ number: 1, cycle: 0 });
    expect(nextCyclicNumber(99, 0, range, { wrap: false })).toEqual({ number: 100, cycle: 0 });
    expect(nextCyclicNumber(100, 0, range, { wrap: false })).toBeNull();
    expect(nextNumber(100, range)).toBeNull();
  });

  it("starts over after the last number and counts the run", () => {
    expect(nextCyclicNumber(100, 0, range, { wrap: true })).toEqual({ number: 1, cycle: 1 });
    expect(nextCyclicNumber(100, 3, range, { wrap: true })).toEqual({ number: 1, cycle: 4 });
  });

  it("skips numbers that are still in use, also across the restart", () => {
    const inUse = (n: number) => [1, 2, 3, 100].includes(n);
    expect(nextCyclicNumber(99, 0, range, { wrap: true, inUse })).toEqual({ number: 4, cycle: 1 });
    expect(nextCyclicNumber(0, 0, range, { wrap: true, inUse })).toEqual({ number: 4, cycle: 0 });
  });

  it("gives up when every number is taken", () => {
    expect(nextCyclicNumber(5, 0, { start: 1, end: 5 }, { wrap: true, inUse: () => true })).toBeNull();
  });
});

describe("call code", () => {
  it("is the last digits of the phone, whatever the formatting or digit system", () => {
    expect(callCodeOf("0501234567", 3)).toBe("567");
    expect(callCodeOf("+963 944 123-472", 3)).toBe("472");
    expect(callCodeOf("٠٥٠١٢٣٤٥٦٧", 3)).toBe("567");
    expect(callCodeOf("0501234567", 4)).toBe("4567");
  });

  it("needs enough digits", () => {
    expect(callCodeOf("12", 3)).toBeNull();
    expect(callCodeOf("abc", 3)).toBeNull();
    expect(callCodeOf("", 3)).toBeNull();
  });
});

describe("announcing a call code", () => {
  const base = {
    templates: {},
    event: "ticket_called" as const,
    settings: { callLanguages: "both_ar_en" as const, ticketReading: "letter_then_number" as const, announceDesk: true },
    displayNumber: "A-014",
    callCode: "472",
    deskNumber: "3",
    ticketLanguage: "ar",
    digits: "latn" as const,
  };

  it("reads the digits one by one, in Arabic and in English", () => {
    expect(callCodeWords("472", "ar")).toBe("أربعة، سبعة، اثنان");
    expect(callCodeWords("472", "en")).toBe("4 7 2");
  });

  it("says the phone digits instead of the ticket number, and the desk", () => {
    const [ar, en] = planAnnouncement(base);
    expect(ar.locale).toBe("ar");
    expect(ar.text).toBe("صاحب الهاتف المنتهي بالأرقام أربعة، سبعة، اثنان، الرجاء التوجه إلى المكتب ثلاثة");
    expect(ar.text).not.toContain("A");
    expect(en.text).toBe("The phone number ending in 4 7 2, please go to desk 3");
    // A recorded pack cannot say this sentence, so it is left to a voice that can.
    expect(ar.keys).toEqual([]);
    expect(ar.units).toBeUndefined();
  });

  it("leaves the desk out when the desk announcement is off", () => {
    const [ar] = planAnnouncement({ ...base, settings: { ...base.settings, announceDesk: false } });
    expect(ar.text).toBe("صاحب الهاتف المنتهي بالأرقام أربعة، سبعة، اثنان");
  });

  it("uses the organization's own wording when it has one", () => {
    const [ar] = planAnnouncement({
      ...base,
      templates: { ticket_called_by_phone: { ar: "الهاتف {code} إلى المكتب {desk}" } },
    });
    expect(ar.text).toBe("الهاتف أربعة، سبعة، اثنان إلى المكتب ثلاثة");
  });

  it("does not change the normal call", () => {
    const [ar] = planAnnouncement({
      ...base,
      callCode: null,
      templates: { ticket_called: { ar: "رقم {ticket}، الرجاء التوجه إلى المكتب {desk}", en: "Number {ticket}, desk {desk}" } },
    });
    expect(ar.text).toContain("ثلاثة");
    expect(ar.text).not.toContain("أربعة، سبعة");
    expect(ar.units?.length).toBeGreaterThan(0);
  });
});
