import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from "@/domain/rbac/permissions";
import { LOCALE_CODES } from "@/i18n/locales";

type Tree = { [k: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

function get(tree: Tree, dotted: string): string | Tree | undefined {
  return dotted.split(".").reduce<string | Tree | undefined>((n, part) => (typeof n === "object" ? n[part] : undefined), tree);
}

function load(locale: string): Tree {
  return JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"));
}

describe("i18n resource files", () => {
  const reference = load("en");
  const refKeys = keys(reference).sort();

  it.each(LOCALE_CODES)("%s has exactly the same keys as en", (locale) => {
    expect(keys(load(locale)).sort()).toEqual(refKeys);
  });

  it.each(LOCALE_CODES)("%s has no empty strings", (locale) => {
    const empty = keys(load(locale)).filter((k) => {
      const v = get(load(locale), k);
      return typeof v === "string" && v.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  it("labels every permission and permission group", () => {
    for (const p of ALL_PERMISSIONS) expect(get(reference, `permissions.${p}`), p).toBeTypeOf("string");
    const groups = reference.permissionGroups as Tree;
    for (const g of Object.keys(PERMISSION_GROUPS)) expect(groups[g], g).toBeTypeOf("string");
  });
});
