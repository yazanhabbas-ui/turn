"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { DisplayState } from "@/server/display/state";

export type { DisplayState };
export type ConnectionState = "connected" | "connecting" | "offline";

export type CallEvent = {
  ticketId: string;
  displayNumber: string;
  deskNumber: string | null;
  reasonId: string;
  language: string;
  recall: boolean;
  /** Set on the per-ticket events of a group call; the screen announces those from `hall.called` instead. */
  hallId?: string | null;
};

/** A group call to a hall: one event for the whole group (D62). */
export type HallCallEvent = {
  hallId: string;
  hallNumber: string;
  hallName: { ar?: string; en?: string };
  sessionId: string;
  tickets: { ticketId: string; displayNumber: string; reasonId: string; language: string }[];
  recall: boolean;
};

const TOKEN_KEY = "dor.display.token";
const CACHE_KEY = "dor.display.state";

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export const readToken = () => safe(() => localStorage.getItem(TOKEN_KEY));
export const saveToken = (token: string) => safe(() => localStorage.setItem(TOKEN_KEY, token));
export const clearToken = () =>
  safe(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CACHE_KEY);
  });

/**
 * Live state of a paired screen. The server is the source of truth: events only tell us to refetch (or that a
 * ticket was called). Survives network drops: keeps showing the last state, retries with back-off, and polls
 * while the socket is down. A revoked token sends the screen back to the pairing page.
 */
export function useDisplayState(token: string, handlers: { onCall: (e: CallEvent) => void; onHallCall: (e: HallCallEvent) => void; onRevoked: () => void }) {
  const [state, setState] = useState<DisplayState | null>(() => {
    const cached = safe(() => localStorage.getItem(CACHE_KEY));
    return cached ? safe(() => JSON.parse(cached) as DisplayState) : null;
  });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [failing, setFailing] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const ref = useRef(handlers);
  ref.current = handlers;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const refetch = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/v1/display/state", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (res.status === 401) {
        ref.current.onRevoked();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as DisplayState;
      setClockOffset(new Date(next.now).getTime() - Date.now());
      setState(next);
      setFailing(false);
      safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(next)));
    } catch {
      setFailing(true);
    } finally {
      inflight.current = false;
    }
  }, [token]);

  const debounced = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), 120);
  }, [refetch]);

  useEffect(() => {
    void refetch();
    const socket = io({
      path: "/socket.io",
      auth: { deviceToken: token },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 5000,
    });
    socket.on("connect", () => {
      setConnection("connected");
      void refetch();
    });
    const down = () => setConnection(navigator.onLine ? "connecting" : "offline");
    socket.on("disconnect", down);
    socket.on("connect_error", (err) => {
      down();
      // The server rejects revoked tokens during the handshake.
      if (err.message === "unauthorized") void refetch();
    });
    socket.on("queue.updated", debounced);
    socket.on("display.refresh", debounced);
    socket.on("ticket.called", (e: CallEvent) => {
      // A visitor called to a hall is announced once, with the group, from `hall.called`.
      if (!e.hallId) ref.current.onCall(e);
      debounced();
    });
    socket.on("hall.called", (e: HallCallEvent) => {
      ref.current.onHallCall(e);
      debounced();
    });
    socket.on("display.revoked", () => ref.current.onRevoked());
    return () => {
      socket.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [token, refetch, debounced]);

  // Safety net: poll fast while the socket is down, slowly otherwise. Back off while the server is unreachable.
  useEffect(() => {
    const ms = connection === "connected" ? 30_000 : failing ? 10_000 : 5_000;
    const id = setInterval(() => void refetch(), ms);
    return () => clearInterval(id);
  }, [connection, failing, refetch]);

  return { state, connection: failing && connection === "connected" ? "connecting" : connection, clockOffset };
}

/** Keeps the screen awake and gives one-tap fullscreen (kiosk mode). */
export function useKiosk() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        /* not supported or denied: the OS setting decides */
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("fullscreenchange", onFs);
      void lock?.release();
    };
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  return { fullscreen, toggle };
}
