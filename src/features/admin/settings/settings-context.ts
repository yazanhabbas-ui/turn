"use client";

import { createContext, useContext } from "react";

/** What a section form needs from the settings shell: report unsaved edits and guard destructive navigation. */
export type SettingsShellApi = {
  /** A form reports whether it holds unsaved edits (keyed by a unique id). */
  setDirty: (id: string, dirty: boolean) => void;
  /** Runs `run` at once, or after the user confirms losing unsaved edits. */
  guard: (run: () => void) => void;
};

const NOOP: SettingsShellApi = { setDirty: () => {}, guard: (run) => run() };

export const SettingsShellContext = createContext<SettingsShellApi>(NOOP);
export const useSettingsShell = () => useContext(SettingsShellContext);

/**
 * Which level the settings page edits: the organization default, one city's overrides or one branch's overrides
 * (organization ← city ← branch, the most specific wins). Forms save to this scope; it lives in `?scope=`.
 */
export type SettingsScope = { kind: "organization" } | { kind: "city"; id: string } | { kind: "branch"; id: string };

export const ORGANIZATION_SCOPE: SettingsScope = { kind: "organization" };

/** Query string for the settings API (`?cityId=` / `?branchId=`), empty for the organization. */
export const scopeQuery = (s: SettingsScope) =>
  s.kind === "city" ? `?cityId=${s.id}` : s.kind === "branch" ? `?branchId=${s.id}` : "";

/** The `?scope=` URL value: `organization`, `city:<id>` or `branch:<id>`. */
export const scopeParam = (s: SettingsScope) => (s.kind === "organization" ? "organization" : `${s.kind}:${s.id}`);

export function parseScope(raw: string | null): SettingsScope | null {
  if (!raw) return null;
  if (raw === "organization") return ORGANIZATION_SCOPE;
  const m = /^(city|branch):([0-9a-f-]{36})$/i.exec(raw);
  return m ? { kind: m[1] as "city" | "branch", id: m[2]! } : null;
}

export const SettingsScopeContext = createContext<SettingsScope>(ORGANIZATION_SCOPE);
export const useSettingsScope = () => useContext(SettingsScopeContext);
