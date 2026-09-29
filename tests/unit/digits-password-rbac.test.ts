import { describe, expect, it } from "vitest";
import { checkPassword, DEFAULT_PASSWORD_POLICY } from "@/domain/auth/password-policy";
import { formatTicketNumber, toEasternDigits, toWesternDigits } from "@/domain/i18n/digits";
import { ALL_PERMISSIONS, branchesFor, can, SYSTEM_ROLES } from "@/domain/rbac/permissions";

describe("digits", () => {
  it("round-trips Western and Eastern Arabic-Indic digits", () => {
    expect(toEasternDigits("A-014")).toBe("A-٠١٤");
    expect(toWesternDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toWesternDigits("۱۲۳")).toBe("123");
  });

  it("formats ticket numbers with Latin or Arabic prefixes", () => {
    expect(formatTicketNumber("A", 14)).toBe("A-014");
    expect(formatTicketNumber("أ", 7, { digits: "arab" })).toBe("أ-٠٠٧");
    expect(formatTicketNumber("B", 5, { pad: 0, separator: "" })).toBe("B5");
  });
});

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(checkPassword("Riyadh-Office-2026", DEFAULT_PASSWORD_POLICY)).toEqual([]);
  });

  it("reports each violated rule", () => {
    expect(checkPassword("short", DEFAULT_PASSWORD_POLICY)).toEqual(expect.arrayContaining(["tooShort", "upper", "digit"]));
    expect(checkPassword("Password123", { ...DEFAULT_PASSWORD_POLICY, minLength: 8 })).toEqual(["common"]);
    expect(checkPassword("Khalid.Otaibi99", DEFAULT_PASSWORD_POLICY, { email: "khalid.otaibi@x.sa" })).toContain("containsEmail");
  });

  it("accepts an Arabic passphrase with digits (Arabic has no letter case)", () => {
    expect(checkPassword("مكتب الرياض 2026", DEFAULT_PASSWORD_POLICY)).toEqual([]);
  });
});

describe("rbac", () => {
  const grants = [
    { branchId: null, permissions: SYSTEM_ROLES.agent },
    { branchId: "b1", permissions: SYSTEM_ROLES.receptionist },
  ];

  it("admin role holds every permission", () => {
    expect(new Set(SYSTEM_ROLES.admin)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it("respects branch scoping", () => {
    expect(can(grants, "agent.serve", "b2")).toBe(true);
    expect(can(grants, "tickets.issue", "b1")).toBe(true);
    expect(can(grants, "tickets.issue", "b2")).toBe(false);
    expect(can(grants, "settings.manage")).toBe(false);
    expect(branchesFor(grants, "tickets.issue")).toEqual(["b1"]);
    expect(branchesFor(grants, "agent.serve")).toBe("all");
  });
});
