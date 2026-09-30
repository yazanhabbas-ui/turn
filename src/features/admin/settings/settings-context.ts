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
