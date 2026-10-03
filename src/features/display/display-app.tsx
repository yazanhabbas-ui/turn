"use client";

import { Maximize2, Minimize2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dirOf } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { ScreenLayout } from "./layouts";
import { Pairing } from "./pairing";
import { makeT, type Dicts } from "./text";
import {
  clearToken,
  readToken,
  saveToken,
  useDisplayState,
  useKiosk,
  type CallEvent,
  type DisplayState,
  type HallCallEvent,
} from "./use-display";
import type { Call } from "./parts";
import { VoiceEngine } from "./voice/engine";
import { buildHallVoiceJob, buildVoiceJob } from "./voice/job";
import { preloadPack } from "./voice/providers";

const FLASH_MS = 12_000;

/** Entry point of the waiting-room screen: pairing first, then the live board once a device token exists. */
export function DisplayApp({ dicts, defaultLang }: { dicts: Dicts; defaultLang: "ar" | "en" }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(readToken()), []);
  const t = makeT(dicts[defaultLang]);

  if (token === undefined) return <div className="min-h-dvh" />;
  if (!token) {
    return (
      <Shell lang={defaultLang}>
        <Pairing
          t={t}
          onPaired={(tok) => {
            saveToken(tok);
            setToken(tok);
          }}
        />
      </Shell>
    );
  }
  return (
    <Screen
      token={token}
      dicts={dicts}
      defaultLang={defaultLang}
      onRevoked={() => {
        clearToken();
        setToken(null);
      }}
    />
  );
}

function Shell({ lang, children }: { lang: "ar" | "en"; children: React.ReactNode }) {
  return (
    <div dir={dirOf(lang)} lang={lang} className="dark min-h-dvh bg-neutral-950 text-neutral-50">
      {children}
    </div>
  );
}

function Screen({
  token,
  dicts,
  defaultLang,
  onRevoked,
}: {
  token: string;
  dicts: Dicts;
  defaultLang: "ar" | "en";
  onRevoked: () => void;
}) {
  const engine = useRef<VoiceEngine | null>(null);
  const stateRef = useRef<DisplayState | null>(null);
  const [unlocked, setUnlocked] = useState(true);
  const [call, setCall] = useState<Call | null>(null);
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [langIndex, setLangIndex] = useState(0);
  const kiosk = useKiosk();

  useEffect(() => {
    engine.current = new VoiceEngine();
    setUnlocked(engine.current.init());
    return () => engine.current?.clear();
  }, []);

  const onCall = useCallback((e: CallEvent) => {
    setCall({ ticketId: e.ticketId, displayNumber: e.displayNumber, deskNumber: e.deskNumber, at: Date.now(), recall: e.recall });
    setFlashing(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), FLASH_MS);

    const s = stateRef.current;
    const eng = engine.current;
    if (!s || !eng || !s.voice.settings.enabled) return;
    const job = buildVoiceJob({
      id: `${e.ticketId}:${e.recall ? "r" : "c"}`,
      settings: s.voice.settings,
      templates: s.voice.templates,
      packs: s.voice.packs,
      deviceToken: token,
      digits: s.regional.digitsVoice,
      displayNumber: e.displayNumber,
      deskNumber: e.deskNumber,
      ticketLanguage: e.language,
      recall: e.recall,
    });
    if (!job) return;
    eng.enqueue(job);
  }, [token]);

  const onHallCall = useCallback((e: HallCallEvent) => {
    if (!e.tickets.length) return;
    const numbers = e.tickets.map((x) => x.displayNumber);
    setCall({
      ticketId: e.tickets[0].ticketId,
      displayNumber: numbers[0],
      deskNumber: null,
      at: Date.now(),
      recall: e.recall,
      hall: { id: e.hallId, number: e.hallNumber, numbers },
    });
    setFlashing(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), FLASH_MS);

    const s = stateRef.current;
    const eng = engine.current;
    if (!s || !eng || !s.voice.settings.enabled) return;
    const job = buildHallVoiceJob({
      id: `${e.sessionId}:${e.recall ? "r" : "c"}:${numbers.join(",")}`,
      settings: s.voice.settings,
      templates: s.voice.templates,
      packs: s.voice.packs,
      deviceToken: token,
      digits: s.regional.digitsVoice,
      hallNumber: e.hallNumber,
      displayNumbers: numbers,
      announce: { mode: s.hallsConfig?.announceMode ?? "list", maxAnnounced: s.hallsConfig?.maxAnnounced ?? 6 },
      ticketLanguage: e.tickets[0].language,
      recall: e.recall,
    });
    if (job) eng.enqueue(job);
  }, [token]);

  const { state, connection, clockOffset } = useDisplayState(token, { onCall, onHallCall, onRevoked });
  stateRef.current = state;

  // Interface language rotation.
  const languages = state?.display.config.languages ?? [defaultLang];
  const rotateSeconds = state?.display.config.rotateSeconds ?? 15;
  useEffect(() => {
    if (languages.length < 2) return;
    const id = setInterval(() => setLangIndex((i) => i + 1), rotateSeconds * 1000);
    return () => clearInterval(id);
  }, [languages.length, rotateSeconds]);
  const lang = languages[langIndex % languages.length] ?? defaultLang;
  const t = useMemo(() => makeT(dicts[lang]), [dicts, lang]);

  // F toggles fullscreen; the cursor hides itself after a few seconds of inactivity.
  const [cursorHidden, setCursorHidden] = useState(false);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const wake = () => {
      setCursorHidden(false);
      clearTimeout(idle);
      idle = setTimeout(() => setCursorHidden(true), 4000);
    };
    const key = (e: KeyboardEvent) => {
      wake();
      if (e.key === "f" || e.key === "F") kiosk.toggle();
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(idle);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", key);
    };
  }, [kiosk]);

  // Browsers block sound until the first tap or key press; any gesture unlocks it.
  useEffect(() => {
    if (unlocked) return;
    const go = async () => {
      const ok = await engine.current?.unlock();
      if (ok) setUnlocked(true);
    };
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, [unlocked]);

  // Decode the recorded voice as soon as the screen has its manifest and the audio context exists, so the first call has no delay.
  const manifest = state?.voice.settings.provider === "pack" ? state.voice.packs.ar : undefined;
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  const manifestKey = manifest ? `${Object.keys(manifest).length}:${manifest["ar.num.1"] ?? manifest["ar.digit.1"] ?? ""}` : "";
  useEffect(() => {
    const ctx = engine.current?.context;
    if (ctx && manifestRef.current) void preloadPack(ctx, manifestRef.current);
  }, [manifestKey]);

  const soundOn = unlocked && !!state?.voice.settings.enabled;
  // Until the first state arrives (or from an older cached state) the screen keeps the classic dark look.
  const theme = state?.display.theme ?? "dark";

  return (
    <div
      dir={dirOf(lang)}
      lang={lang}
      data-theme={theme}
      className={cn("dor-display min-h-dvh", theme !== "light" && "dark", cursorHidden && "cursor-none")}
      style={
        {
          "--dsp-primary": state?.branding.primaryColor,
          "--dsp-accent-brand": state?.branding.accentColor,
        } as React.CSSProperties
      }
      onDoubleClick={kiosk.toggle}
    >
      {state ? (
        <ScreenLayout
          state={state}
          lang={lang}
          t={t}
          call={call}
          flashing={flashing}
          clockOffset={clockOffset}
          connection={connection}
          soundOn={soundOn}
        />
      ) : (
        <div className="text-dsp-muted grid h-dvh place-items-center text-4xl">{t("loading")}</div>
      )}

      {!cursorHidden && (
        <button
          type="button"
          onClick={kiosk.toggle}
          aria-label={kiosk.fullscreen ? t("exitFullscreen") : t("fullscreen")}
          className="bg-dsp-line/80 text-dsp-soft hover:bg-dsp-line fixed end-4 bottom-4 z-20 rounded-full p-3"
        >
          {kiosk.fullscreen ? <Minimize2 className="size-6" /> : <Maximize2 className="size-6" />}
        </button>
      )}

      {!unlocked && state?.voice.settings.enabled && (
        <div
          role="button"
          tabIndex={0}
          className="fixed inset-0 z-30 grid cursor-pointer place-items-center bg-black/85 text-center text-white"
        >
          <span>
            <Volume2 className="mx-auto size-28 text-amber-300" aria-hidden />
            <span className="mt-8 block text-6xl font-bold">{t("unlockTitle")}</span>
            <span className="mt-4 block text-3xl text-neutral-300">{t("unlockHint")}</span>
          </span>
        </div>
      )}
    </div>
  );
}
