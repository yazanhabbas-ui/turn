import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import type { CatalogEntry } from "./catalog";

const FILES: Record<"ar" | "en", unknown> = { ar: arMessages, en: enMessages };

/** The translation at a dotted path of the message files, or undefined when the path does not lead to a text. */
export function messageAt(lang: "ar" | "en", path: string): string | undefined {
  let node: unknown = FILES[lang];
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** The default wording of a catalogue entry (from the message files), per language. */
export function defaultText(entry: Pick<CatalogEntry, "path">, lang: "ar" | "en"): string {
  return messageAt(lang, entry.path) ?? "";
}
