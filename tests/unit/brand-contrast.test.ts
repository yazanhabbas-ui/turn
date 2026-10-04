import { describe, expect, it } from "vitest";
import { luminanceOf, onColor, onColorLarge } from "@/domain/branding/contrast";

describe("text on a brand colour", () => {
  it("uses white on dark colours and near-black on pale ones", () => {
    expect(onColor("#0f766e")).toBe("#ffffff");
    expect(onColor("#ffffff")).toBe("#0b1220");
    expect(onColor("#fde047")).toBe("#0b1220");
  });

  it("keeps white on a mid-tone brand colour for large text only", () => {
    // A bright blue: too pale for small white text, fine for the kiosk's large headings and buttons.
    expect(onColor("#2596ff")).toBe("#0b1220");
    expect(onColorLarge("#2596ff")).toBe("#ffffff");
    expect(onColorLarge("#fde047")).toBe("#0b1220");
  });

  it("falls back to white for anything that is not a #rrggbb colour", () => {
    expect(luminanceOf("blue")).toBeNull();
    expect(onColor(undefined)).toBe("#ffffff");
    expect(onColorLarge("rgb(0,0,0)")).toBe("#ffffff");
  });
});
