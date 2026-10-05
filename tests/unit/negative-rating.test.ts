import { describe, expect, it } from "vitest";
import { clampThreshold, isNegative, negativePct, negativeScores, truncateComment } from "@/domain/feedback/negative";
import { defaultSetting, SETTINGS } from "@/server/settings/registry";
import { ADMIN_NAV_ITEMS } from "@/features/admin/admin-nav";

describe("negative rating threshold", () => {
  it("counts scores up to the threshold", () => {
    expect([1, 2, 3, 4, 5].filter((s) => isNegative(s, 2))).toEqual([1, 2]);
    expect([1, 2, 3, 4, 5].filter((s) => isNegative(s, 1))).toEqual([1]);
    expect([1, 2, 3, 4, 5].filter((s) => isNegative(s, 3))).toEqual([1, 2, 3]);
  });
  it("lists the negative scores and clamps the value", () => {
    expect(negativeScores(2)).toEqual([1, 2]);
    expect(negativeScores(4)).toEqual([1, 2, 3, 4]);
    expect(clampThreshold(9)).toBe(4);
    expect(clampThreshold(0)).toBe(1);
  });
  it("computes the negative share", () => {
    expect(negativePct([], 2)).toBeNull();
    expect(negativePct([1, 2, 5, 5], 2)).toBe(50);
    expect(negativePct([1, 2, 5, 5], 1)).toBe(25);
  });
  it("truncates long comments", () => {
    expect(truncateComment("short", 80)).toBe("short");
    expect(truncateComment("x".repeat(200), 20)).toHaveLength(20);
    expect(truncateComment("x".repeat(200), 20).endsWith("…")).toBe(true);
  });
});

describe("negative rating settings", () => {
  it("has the defaults of the wallboard panel and the threshold", () => {
    expect(defaultSetting("feedback").lowScoreThreshold).toBe(2);
    expect(defaultSetting("wallboard")).toMatchObject({
      showNegativeRatings: true,
      negativeRatingsCount: 5,
      negativeRatingsHours: 24,
      showNegativeComment: false,
    });
  });
  it("keeps the ranges", () => {
    expect(SETTINGS.wallboard.safeParse({ negativeRatingsCount: 11 }).success).toBe(false);
    expect(SETTINGS.wallboard.safeParse({ negativeRatingsCount: 0 }).success).toBe(false);
    expect(SETTINGS.wallboard.safeParse({ negativeRatingsHours: 169 }).success).toBe(false);
    expect(SETTINGS.wallboard.safeParse({ negativeRatingsHours: 168 }).success).toBe(true);
    expect(SETTINGS.feedback.safeParse({ lowScoreThreshold: 5 }).success).toBe(false);
    expect(SETTINGS.feedback.safeParse({ lowScoreThreshold: 4 }).success).toBe(true);
  });
});

describe("admin navigation", () => {
  it("hides Notifications (messaging is not exposed in the product)", () => {
    expect(ADMIN_NAV_ITEMS.some((i) => (i.key as string) === "notifications")).toBe(false);
  });
});
