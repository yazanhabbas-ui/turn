import { describe, expect, it } from "vitest";
import {
  BRANCH_OVERRIDABLE,
  CITY_OVERRIDABLE,
  isBranchOverridable,
  isCityOverridable,
  SETTINGS,
} from "@/server/settings/registry";
import { pickByCity } from "@/server/settings/templates";

describe("city-overridable settings", () => {
  it("only lists real settings, without duplicates", () => {
    for (const k of CITY_OVERRIDABLE) expect(k in SETTINGS).toBe(true);
    expect(new Set(CITY_OVERRIDABLE).size).toBe(CITY_OVERRIDABLE.length);
  });

  it("includes everything a branch may override", () => {
    for (const k of BRANCH_OVERRIDABLE) expect(isCityOverridable(k)).toBe(true);
  });

  it("keeps identity, security and privacy at organization level", () => {
    for (const k of ["branding", "security", "privacy"]) {
      expect(isCityOverridable(k)).toBe(false);
      expect(isBranchOverridable(k)).toBe(false);
    }
  });

  it("lets cities differ in the operational settings", () => {
    for (const k of ["regional", "ticketing", "reception", "wifi", "agentWork", "breaks", "feedback", "notifications"])
      expect(isCityOverridable(k)).toBe(true);
  });
});

describe("pickByCity", () => {
  const org = { cityId: null, body: "org" };
  const dam = { cityId: "dam", body: "dam" };
  it("prefers the city's own row, otherwise the organization's", () => {
    expect(pickByCity([org, dam], "dam")?.body).toBe("dam");
    expect(pickByCity([org, dam], "alp")?.body).toBe("org");
    expect(pickByCity([dam, org], null)?.body).toBe("org");
    expect(pickByCity([dam], "alp")).toBeUndefined();
  });
});
