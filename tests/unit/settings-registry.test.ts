import { describe, expect, it } from "vitest";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

describe("settings registry", () => {
  it("fills nested defaults", () => {
    const s = defaultSetting("security");
    expect(s.passwordPolicy.minLength).toBe(10);
    expect(s.maxFailedLogins).toBe(5);
  });

  it("defaults reception to the fastest flow", () => {
    expect(defaultSetting("reception")).toMatchObject({
      oneTapIssue: true,
      afterIssue: "print",
      autoPrint: true,
      defaultLanguage: "interface",
    });
    expect(parseSetting("reception", { afterIssue: "nope" }).afterIssue).toBe("print");
  });

  it("agents serve one visitor by default; the wallboard defaults are safe", () => {
    expect(defaultSetting("agentWork")).toMatchObject({ multipleVisitors: false, visitorsPerAgent: 2 });
    expect(defaultSetting("wallboard")).toMatchObject({ theme: "dark", showLogo: true, textScale: 100 });
    expect(parseSetting("wallboard", { textScale: 500 }).textScale).toBe(100);
    expect(defaultSetting("branding").font).toBe("IBM Plex Sans Arabic");
    expect(parseSetting("branding", { font: "FF Hekaya Light" }).font).toBe("FF Hekaya Light");
  });

  it("keeps stored values and adds fields introduced later", () => {
    const s = parseSetting("branding", { primaryColor: "#123456" });
    expect(s.primaryColor).toBe("#123456");
    expect(s.font).toBe("IBM Plex Sans Arabic");
  });

  it("falls back to defaults for an invalid stored value", () => {
    expect(parseSetting("ticketing", { numberPad: "x" }).numberPad).toBe(3);
  });
});
