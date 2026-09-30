import { describe, expect, it } from "vitest";
import { wifiQrPayload } from "@/domain/wifi/qr";
import { defaultSetting, parseSetting } from "@/server/settings/registry";

describe("Wi-Fi on the ticket", () => {
  it("builds the QR text phones understand, escaping special characters", () => {
    expect(wifiQrPayload("Guest", "pass1234")).toBe("WIFI:T:WPA;S:Guest;P:pass1234;;");
    expect(wifiQrPayload("Open", "")).toBe("WIFI:T:nopass;S:Open;;");
    // ; , : " and \ are escaped with a backslash.
    const backslash = "\\";
    const password = 'p:"x",' + backslash;
    const escaped = ["p", ":", '"', "x", '"', ",", backslash].map((c) => (':;,"\\'.includes(c) ? backslash + c : c)).join("");
    expect(escaped).toBe(String.raw`p\:\"x\"\,\\`);
    expect(wifiQrPayload("A;B", password)).toBe(`WIFI:T:WPA;S:A${backslash};B;P:${escaped};;`);
  });

  it("is off by default and validates its fields", () => {
    expect(defaultSetting("wifi")).toMatchObject({ enabled: false, ssid: "", password: "", showQr: false });
    expect(defaultSetting("wifi").title.ar).toBeTruthy();
    expect(parseSetting("wifi", { enabled: true, ssid: "x".repeat(40) }).enabled).toBe(false); // invalid → defaults
    expect(parseSetting("wifi", { enabled: true, ssid: "Guest", password: "secret123" })).toMatchObject({
      enabled: true,
      ssid: "Guest",
    });
  });
});
