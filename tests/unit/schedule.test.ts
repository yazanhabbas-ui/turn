import { describe, expect, it } from "vitest";
import { intervalsFor, issuingState } from "@/domain/schedule/hours";
import { serviceDay, zonedParts, zonedToUtc } from "@/domain/schedule/time";
import { nextNumber } from "@/domain/tickets/numbering";

const TZ = "Asia/Riyadh";
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm, TZ);
const rules = [
  ...[0, 1, 2, 3, 4].map((weekday) => ({ kind: "regular", weekday, opensAt: "08:00", closesAt: "16:00" })),
  ...[0, 1, 2, 3, 4].map((weekday) => ({ kind: "ramadan", weekday, opensAt: "10:00", closesAt: "15:00" })),
];

describe("time zones", () => {
  it("converts local wall time to UTC and back", () => {
    const ts = at("2026-09-29", "10:30");
    expect(new Date(ts).toISOString()).toBe("2026-09-29T07:30:00.000Z");
    expect(zonedParts(ts, TZ)).toMatchObject({ date: "2026-09-29", minutes: 630, weekday: 2 });
  });

  it("service day rolls over at the reset time, not midnight", () => {
    expect(serviceDay(at("2026-09-30", "01:30"), TZ, "03:00")).toBe("2026-09-29");
    expect(serviceDay(at("2026-09-30", "03:01"), TZ, "03:00")).toBe("2026-09-30");
    expect(serviceDay(at("2026-09-30", "00:10"), TZ, "00:00")).toBe("2026-09-30");
  });
});

describe("business hours", () => {
  it("is open during hours, closed on the weekend and after hours", () => {
    expect(issuingState(at("2026-09-29", "09:00"), TZ, rules)).toMatchObject({ open: true });
    expect(issuingState(at("2026-10-02", "09:00"), TZ, rules)).toMatchObject({ open: false, reason: "closed" }); // Friday
    expect(issuingState(at("2026-09-29", "07:00"), TZ, rules)).toMatchObject({ open: false, reason: "closed", opensAt: 480 });
  });

  it("applies the cut-off before closing", () => {
    expect(issuingState(at("2026-09-29", "15:50"), TZ, rules, { cutoffMinutes: 15 })).toMatchObject({
      open: false,
      reason: "cutoff",
    });
    expect(issuingState(at("2026-09-29", "15:40"), TZ, rules, { cutoffMinutes: 15 })).toMatchObject({
      open: true,
      closesInMinutes: 20,
    });
  });

  it("uses Ramadan hours during Ramadan mode", () => {
    const ramadan = { enabled: true, from: "2026-09-20", to: "2026-10-19" };
    expect(intervalsFor("2026-09-29", 2, rules, { ramadan })).toEqual([[600, 900]]);
    expect(issuingState(at("2026-09-29", "09:00"), TZ, rules, { ramadan })).toMatchObject({ open: false });
  });

  it("no schedule means always open", () => {
    expect(issuingState(at("2026-10-02", "03:00"), TZ, null)).toMatchObject({ open: true });
  });
});

describe("numbering", () => {
  it("continues the day's sequence within the queue range", () => {
    expect(nextNumber(0, { start: 1, end: 999 })).toBe(1);
    expect(nextNumber(14, { start: 1, end: 999 })).toBe(15);
    expect(nextNumber(0, { start: 100, end: 199 })).toBe(100);
    expect(nextNumber(199, { start: 100, end: 199 })).toBeNull();
  });
});
