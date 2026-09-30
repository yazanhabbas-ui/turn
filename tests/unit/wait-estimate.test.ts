import { describe, expect, it } from "vitest";
import {
  estimateWait,
  estimateWaitMinutes,
  resolveServiceMinutes,
  samplesNear,
  summarizeSamples,
  waitValueText,
  type ServiceModelConfig,
  type ServiceSample,
} from "@/domain/distribution/estimate";

const base: ServiceModelConfig = {
  mode: "reason",
  fixedMinutesPerVisitor: 5,
  minSamples: 5,
  statistic: "median",
  weightByHour: false,
  trimOutliers: true,
};
const shape = { divideByAgents: true, rounding: 1, bufferPercent: 0 };
const s = (minutes: number, hour = 10, dow = 2): ServiceSample => ({ minutes, hour, dow });

describe("summarizeSamples", () => {
  it("computes count, average, median and percentiles", () => {
    const r = summarizeSamples([1, 2, 3, 4, 5], { trimOutliers: false });
    expect(r).toMatchObject({ n: 5, average: 3, median: 3, p25: 2, p75: 4 });
    expect(r.p90).toBeCloseTo(4.6);
  });
  it("is empty without samples", () => {
    expect(summarizeSamples([])).toEqual({ n: 0, average: 0, median: 0, p25: 0, p75: 0, p90: 0 });
  });
  it("ignores services under 20 seconds and over 4 hours when trimming, and drops 5% at each end", () => {
    const d = [0.1, 300, ...Array.from({ length: 40 }, () => 5), 1000000];
    const r = summarizeSamples([...d, 0.2], { trimOutliers: true });
    expect(r.n).toBe(40);
    expect(r.average).toBe(5);
    const withOutliers = summarizeSamples([...Array(19).fill(1), 200], { trimOutliers: false });
    const trimmed = summarizeSamples([...Array(19).fill(1), 200], { trimOutliers: true });
    expect(withOutliers.average).toBeGreaterThan(10);
    expect(trimmed.average).toBe(1);
  });
});

describe("resolveServiceMinutes", () => {
  it("fixed uses the configured minutes, reason uses the reason's time", () => {
    expect(resolveServiceMinutes({ ...base, mode: "fixed" }, 9)).toMatchObject({ minutes: 5, source: "fixed" });
    expect(resolveServiceMinutes(base, 9)).toMatchObject({ minutes: 9, source: "reason" });
  });
  it("analytics learns with the chosen statistic once there are enough samples", () => {
    const samples = [2, 3, 4, 5, 20].map((m) => s(m));
    const a = { ...base, mode: "analytics" as const };
    expect(resolveServiceMinutes({ ...a, statistic: "median" }, 9, samples)).toMatchObject({
      minutes: 4,
      source: "analytics",
      n: 5,
    });
    expect(resolveServiceMinutes({ ...a, statistic: "average" }, 9, samples).minutes).toBe(6.8);
    expect(resolveServiceMinutes({ ...a, statistic: "p75" }, 9, samples).minutes).toBe(5);
    const r = resolveServiceMinutes(a, 9, samples);
    expect(r.low).toBe(3);
    expect(r.high).toBe(5);
  });
  it("falls back to the reason's time (learning) below minSamples", () => {
    const r = resolveServiceMinutes({ ...base, mode: "analytics" }, 9, [s(2), s(3)]);
    expect(r).toMatchObject({ minutes: 9, source: "learning", n: 2 });
  });
  it("prefers samples from the same hour when there are enough", () => {
    const samples = [...Array.from({ length: 5 }, () => s(10, 9)), ...Array.from({ length: 5 }, () => s(2, 15))];
    const a = { ...base, mode: "analytics" as const, weightByHour: true };
    expect(resolveServiceMinutes(a, 9, samples, { hour: 10, dow: 2 }).minutes).toBe(10);
    expect(resolveServiceMinutes(a, 9, samples, { hour: 15, dow: 2 }).minutes).toBe(2);
    // Nothing near the hour: all samples are used.
    expect(resolveServiceMinutes(a, 9, samples, { hour: 3, dow: 2 }).n).toBe(10);
    expect(samplesNear([s(1, 23), s(1, 0), s(1, 12)], { hour: 0, dow: 1 }, 2)).toHaveLength(2);
  });
});

describe("estimateWait", () => {
  it("matches the previous behaviour with default settings", () => {
    for (const [ahead, agents, avg] of [
      [0, 1, 5],
      [1, 1, 5],
      [3, 2, 7],
      [7, 3, 4.2],
    ] as const) {
      expect(estimateWait(ahead, agents, avg, shape).minutes).toBe(estimateWaitMinutes(ahead, agents, avg));
    }
  });
  it("divides by agents only when asked", () => {
    expect(estimateWait(6, 3, 5, shape).minutes).toBe(10);
    expect(estimateWait(6, 3, 5, { ...shape, divideByAgents: false }).minutes).toBe(30);
  });
  it("rounds up to the step and adds the buffer", () => {
    expect(estimateWait(3, 1, 4, { ...shape, rounding: 5 }).minutes).toBe(15);
    expect(estimateWait(2, 1, 4, { ...shape, rounding: 10 }).minutes).toBe(10);
    expect(estimateWait(2, 1, 5, { ...shape, bufferPercent: 50 }).minutes).toBe(15);
  });
  it("returns a range from the typical short and long service", () => {
    expect(estimateWait(2, 1, { minutes: 5, low: 4, high: 7 }, shape)).toEqual({ minutes: 10, low: 8, high: 14 });
    expect(estimateWait(2, 1, { minutes: 5, low: 4, high: 7 }, { ...shape, rounding: 5 })).toEqual({
      minutes: 10,
      low: 10,
      high: 15,
    });
    expect(estimateWait(0, 1, 5, shape)).toEqual({ minutes: 0, low: 0, high: 0 });
  });
});

describe("waitValueText", () => {
  const cfg = {
    showAsRange: false,
    minShown: 3,
    nextText: { ar: "خلال دقائق", en: "Within minutes" },
    unitLabel: { ar: "دقيقة", en: "min" },
  };
  const en = (l: Record<string, string>) => l.en;
  it("shows the next text under minShown", () => {
    expect(waitValueText({ minutes: 2, low: 2, high: 2 }, cfg, en)).toEqual({ next: true, text: "Within minutes" });
    expect(waitValueText({ minutes: 3, low: 3, high: 3 }, cfg, en)).toEqual({ next: false, text: "3 min" });
  });
  it("shows a range when asked and it differs", () => {
    const r = { ...cfg, showAsRange: true };
    expect(waitValueText({ minutes: 12, low: 10, high: 15 }, r, en).text).toBe("10–15 min");
    expect(waitValueText({ minutes: 10, low: 10, high: 10 }, r, en).text).toBe("10 min");
  });
});
