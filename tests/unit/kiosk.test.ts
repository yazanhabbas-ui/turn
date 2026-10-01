import { describe, expect, it } from "vitest";
import { groupDigits, pressKey } from "@/domain/kiosk/keypad";
import { fieldSelfService, kioskAllows, kioskFields, kioskReasonState } from "@/domain/kiosk/self-service";

describe("kiosk keypad", () => {
  it("appends digits, deletes, clears and stops at the maximum", () => {
    expect(pressKey("09", "4")).toBe("094");
    expect(pressKey("094", "back")).toBe("09");
    expect(pressKey("094", "clear")).toBe("");
    expect(pressKey("123", "5", 3)).toBe("123");
    expect(groupDigits("0944123456")).toBe("094 412 3456");
  });
});

describe("kiosk self-service rules", () => {
  it("defaults: name/phone allowed, ID digits and custom fields staff-only, explicit flag wins", () => {
    expect(fieldSelfService({ key: "phone", required: true })).toBe(true);
    expect(fieldSelfService({ key: "national_id_last4", required: true })).toBe(false);
    expect(fieldSelfService({ key: "custom_1", required: false })).toBe(false);
    expect(fieldSelfService({ key: "national_id_last4", required: true, selfService: true })).toBe(true);
  });
  it("asks for staff when a required field is staff-only or the reason requires staff", () => {
    expect(kioskReasonState({ intakeFields: [{ key: "phone", required: true }] })).toBe("available");
    expect(kioskReasonState({ intakeFields: [{ key: "national_id_last4", required: true }] })).toBe("ask_staff");
    expect(kioskReasonState({ intakeFields: [{ key: "national_id_last4", required: false }] })).toBe("available");
    expect(kioskReasonState({ requiresStaff: true, intakeFields: [] })).toBe("ask_staff");
    expect(
      kioskFields({
        intakeFields: [
          { key: "phone", required: true },
          { key: "national_id_last4", required: false },
        ],
      }),
    ).toHaveLength(1);
  });
  it("an empty allowed list means every reason", () => {
    expect(kioskAllows([], "a")).toBe(true);
    expect(kioskAllows(["b"], "a")).toBe(false);
  });
});
