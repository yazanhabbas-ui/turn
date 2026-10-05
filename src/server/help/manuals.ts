import fs from "node:fs";
import path from "node:path";
import { can, type Grant } from "@/domain/rbac/permissions";

export const MANUAL_LANGS = ["ar", "en"] as const;
export type ManualLang = (typeof MANUAL_LANGS)[number];

/** Where `npm run manuals:build` writes the PDFs. The Docker image carries this folder (see Dockerfile). */
const ROOT = path.join(process.cwd(), "docs", "manuals", "pdf");

/** Only the published manuals: one per role, plus the combined file. Anything else in the folder is not offered. */
const FILE = /^Dor-(?:User-Manual|Manual-(\d{2})-([a-z]+))-(?:AR|EN)\.pdf$/;

export type ManualFile = {
  lang: ManualLang;
  file: string;
  /** `all` for the combined manual, else the role slug (`overview`, `agent`, ...). */
  topic: string;
  /** Order in the list: overview first, the combined file last. */
  order: number;
  bytes: number;
};

/** The manuals available in one language, in reading order. */
export function listManuals(lang: ManualLang): ManualFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(ROOT, lang));
  } catch {
    return [];
  }
  const out: ManualFile[] = [];
  for (const file of names) {
    const m = FILE.exec(file);
    if (!m) continue;
    const bytes = fs.statSync(path.join(ROOT, lang, file)).size;
    out.push({ lang, file, topic: m[2] ?? "all", order: m[1] ? Number(m[1]) : 99, bytes });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** The absolute path of a manual, or null unless it is one of the listed files (no path tricks possible). */
export function manualPath(lang: string, file: string): string | null {
  if (!(MANUAL_LANGS as readonly string[]).includes(lang)) return null;
  const hit = listManuals(lang as ManualLang).find((m) => m.file === file);
  return hit ? path.join(ROOT, lang, hit.file) : null;
}

/**
 * The manual topics that fit what a person can do, judged by permissions (so custom roles work too). The overview is
 * for everyone; the full manual is for administrators.
 */
export function topicsFor(grants: readonly Grant[]): string[] {
  const topics = ["overview"];
  if (can(grants, "agent.serve")) topics.push("agent");
  if (can(grants, "tickets.issue")) topics.push("receptionist");
  if (can(grants, "reports.view") || can(grants, "wallboard.view")) topics.push("supervisor");
  if (can(grants, "admin.access")) topics.push("admin");
  if (can(grants, "displays.manage")) topics.push("screens");
  if (can(grants, "admin.access")) topics.push("all");
  return topics;
}

/** The manuals of one language that suit these grants. */
export function manualsFor(lang: ManualLang, grants: readonly Grant[]): ManualFile[] {
  const topics = topicsFor(grants);
  return listManuals(lang)
    .filter((m) => topics.includes(m.topic))
    .sort((a, b) => topics.indexOf(a.topic) - topics.indexOf(b.topic));
}
