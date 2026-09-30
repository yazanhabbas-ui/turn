import { describe, expect, it } from "vitest";
import { buildIndex, filterAndRank, matches, scoreMatch } from "@/lib/picker-search";

describe("matches", () => {
  it("ignores alef, yaa, taa marbuta variants and tashkeel", () => {
    expect(matches("احمد", "أحمد")).toBe(true);
    expect(matches("أحمد", "احمد")).toBe(true);
    expect(matches("فاطمه", "فاطمة")).toBe(true);
    expect(matches("محمد", "مُحَمَّد")).toBe(true);
    expect(matches("مصطفى", "مصطفي")).toBe(true);
  });
  it("is case-insensitive and needs every word", () => {
    expect(matches("YAZAN hab", "Yazan Habbas")).toBe(true);
    expect(matches("yazan xyz", "Yazan Habbas")).toBe(false);
  });
  it("treats Arabic-Indic and Western digits alike", () => {
    expect(matches("٣", "Desk 3")).toBe(true);
    expect(matches("3", "مكتب ٣")).toBe(true);
  });
});

describe("scoreMatch", () => {
  const ix = buildIndex({
    names: ["Sara Ali", "سارة علي"],
    ids: ["sara@example.com", "+963 944 123 456", "E-1042"],
    context: ["Damascus Main", "Desk 4"],
  });
  it("finds by e-mail, employee number, branch and desk", () => {
    expect(scoreMatch(ix, "sara@ex")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "e-1042")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "damascus")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "سارة")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "zzz")).toBe(0);
  });
  it("matches a phone typed locally or internationally, in any digit script", () => {
    expect(scoreMatch(ix, "0944 123 456")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "٠٩٤٤١٢٣")).toBeGreaterThan(0);
    expect(scoreMatch(ix, "+963944123456")).toBeGreaterThan(0);
  });
  it("empty query matches everything", () => {
    expect(scoreMatch(ix, "  ")).toBe(1);
  });
});

describe("filterAndRank", () => {
  const people = [
    { n: "Maria Sam", e: "a@x.com" },
    { n: "Sam Lee", e: "b@x.com" },
    { n: "Rosamund", e: "c@x.com" },
    { n: "Tom", e: "sam@x.com" },
  ];
  const ix = (p: (typeof people)[number]) => buildIndex({ names: [p.n], ids: [p.e] });
  it("ranks name prefix, then word start, then identifiers, then substring", () => {
    expect(filterAndRank(people, "sam", ix).map((p) => p.n)).toEqual(["Sam Lee", "Maria Sam", "Tom", "Rosamund"]);
  });
  it("keeps the original order for an empty query", () => {
    expect(filterAndRank(people, "", ix)).toBe(people);
  });
});
