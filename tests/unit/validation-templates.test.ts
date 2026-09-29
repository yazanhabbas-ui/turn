import { describe, expect, it } from "vitest";
import { maskRecipient, placeholdersOf, renderTemplate } from "@/domain/templates/render";
import { isValidTimezone, localizedText, ticketPrefix } from "@/domain/validation";

describe("localizedText", () => {
  const schema = localizedText();

  it("requires Arabic or English and trims values", () => {
    expect(schema.parse({ ar: "  شكوى ", en: "" })).toEqual({ ar: "شكوى" });
    expect(schema.safeParse({ ar: " " }).success).toBe(false);
    expect(schema.safeParse({ xx: "hi", ar: "x" }).success).toBe(false);
  });

  it("can be optional", () => {
    expect(localizedText({ required: false }).parse({})).toEqual({});
  });
});

describe("ticket prefix", () => {
  it.each(["A", "AB", "أ", "ب", "VIP"])("accepts %s", (p) => expect(ticketPrefix.safeParse(p).success).toBe(true));
  it.each(["", "1", "A-", "ABCD", "A B"])("rejects %s", (p) => expect(ticketPrefix.safeParse(p).success).toBe(false));
});

describe("timezones", () => {
  it("validates IANA names", () => {
    expect(isValidTimezone("Asia/Riyadh")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });
});

describe("templates", () => {
  it("fills placeholders and keeps unknown ones visible", () => {
    expect(renderTemplate("رقم {ticket}، الرجاء التوجه إلى المكتب {desk}", { ticket: "A-014", desk: 3 })).toBe(
      "رقم A-014، الرجاء التوجه إلى المكتب 3",
    );
    expect(renderTemplate("Hi {name} {missing}", { name: "Sara" })).toBe("Hi Sara {missing}");
    expect(placeholdersOf("{a} {b} {a}")).toEqual(["a", "b"]);
  });

  it("masks recipients", () => {
    expect(maskRecipient("+966501234567")).toBe("+9665****4567");
    expect(maskRecipient("khalid@example.com")).toBe("k****@example.com");
  });
});
