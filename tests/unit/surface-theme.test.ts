import { describe, expect, it } from "vitest";
import { logoForTheme, resolveSurfaceTheme } from "@/domain/branding/surface-theme";

describe("surface theme helpers", () => {
  it("uses the dark logo on dark and brand backgrounds and the main logo on light", () => {
    const both = { logoUrl: "/light.png", logoDarkUrl: "/dark.png" };
    expect(logoForTheme("dark", both)).toBe("/dark.png");
    expect(logoForTheme("brand", both)).toBe("/dark.png");
    expect(logoForTheme("light", both)).toBe("/light.png");
  });

  it("falls back to the main logo when there is no dark one", () => {
    expect(logoForTheme("dark", { logoUrl: "/light.png", logoDarkUrl: null })).toBe("/light.png");
    expect(logoForTheme("brand", { logoUrl: "/light.png" })).toBe("/light.png");
    expect(logoForTheme("dark", { logoUrl: null, logoDarkUrl: null })).toBeNull();
  });

  it("resolves a screen's choice against the default", () => {
    expect(resolveSurfaceTheme("default", "brand")).toBe("brand");
    expect(resolveSurfaceTheme(undefined, "light")).toBe("light");
    expect(resolveSurfaceTheme("dark", "light")).toBe("dark");
  });
});
