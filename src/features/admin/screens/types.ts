import type { L } from "../types";

export type Layout = "classic" | "single" | "multi";
export type Lang = "ar" | "en";

export type DisplayVoice = { enabled?: boolean; volume?: number; rate?: number };
export type DisplayConfig = {
  languages: Lang[];
  rotateSeconds: number;
  zones: string[];
  showTicker: boolean;
  showSlides: boolean;
  showWaiting: boolean;
  showClock: boolean;
  voice: DisplayVoice;
};

export type Display = {
  id: string;
  name: string;
  branchId: string;
  kind: string;
  layout: Layout;
  config: DisplayConfig;
  paired: boolean;
  revoked: boolean;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string | null;
  userAgent: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
};

export type Pairing = { pairingCode: string; pairingExpiresAt: string };

export type Announcement = {
  id: string;
  kind: "ticker" | "slide";
  body: L;
  mediaUrl: string | null;
  durationSeconds: number;
  branchId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type VoiceTemplate = { id: string; channel: string; event: string; body: L; isActive: boolean };

export type AudioPack = {
  id: string;
  locale: Lang;
  name: string;
  isActive: boolean;
  clips: number;
  manifest: Record<string, string>;
};

export const DEFAULT_CONFIG: DisplayConfig = {
  languages: ["ar", "en"],
  rotateSeconds: 15,
  zones: [],
  showTicker: true,
  showSlides: true,
  showWaiting: true,
  showClock: true,
  voice: {},
};
