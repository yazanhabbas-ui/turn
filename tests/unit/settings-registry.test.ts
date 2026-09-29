import { describe, expect, it } from "vitest";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

describe("settings registry", () => {
  it("fills nested defaults", () => {
    const s = defaultSetting("security");
    expect(s.passwordPolicy.minLength).toBe(10);
    expect(s.maxFailedLogins).toBe(5);
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
