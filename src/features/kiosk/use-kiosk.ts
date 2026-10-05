"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { KioskContext } from "@/server/kiosk/service";

export type { KioskContext };
export type KioskReason = KioskContext["reasons"][number];
export type KioskField = KioskReason["intakeFields"][number];

const TOKEN_KEY = "dor.kiosk.token";
const CACHE_KEY = "dor.kiosk.context";
const REFRESH_MS = 30_000;

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
 * The kiosk's configuration (reasons, options, wording). Like the waiting-room screen it keeps the last answer in
 * the browser, so a short network drop still shows the buttons; issuing a ticket always needs the server (the kiosk
 * never queues anybody by itself). It refetches every 30 s, which also keeps the device "online" in the admin.
 */
export function useKioskContext(token: string, onRevoked: () => void) {
  const [ctx, setCtx] = useState<KioskContext | null>(() => {
    const cached = safe(() => localStorage.getItem(CACHE_KEY));
    return cached ? safe(() => JSON.parse(cached) as KioskContext) : null;
  });
  const [failing, setFailing] = useState(false);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/kiosk/context", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (res.status === 401) {
        revoked.current();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as KioskContext;
      setCtx(next);
      setFailing(false);
      safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(next)));
    } catch {
      setFailing(true);
    }
  }, [token]);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), REFRESH_MS);
    const online = () => void refetch();
    window.addEventListener("online", online);
    // A change made in Admin → Settings reaches the kiosk at once; the 30 s poll above stays as the safety net.
    const socket = io({
      path: "/socket.io",
      auth: { deviceToken: token, kind: "kiosk" },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 10_000,
    });
    socket.on("kiosk.refresh", () => void refetch());
    socket.on("connect_error", () => undefined);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", online);
      socket.close();
    };
  }, [refetch]);

  return { ctx, failing, refetch };
}

export type KioskTicket = {
  duplicate: boolean;
  ticket: { id: string; displayNumber: string; publicToken: string; language: string; reasonId: string; arrivedAt: string };
  ahead: number;
  estimatedWaitMinutes: number;
  waitLow: number;
  waitHigh: number;
};

export class KioskError extends Error {
  constructor(
    readonly kind:
      | "network"
      | "unauthorized"
      | "queue_full"
      | "rate_limited"
      | "ask_staff"
      | "disabled"
      | "invalid_phone"
      | "missing_field"
      | "other",
    readonly field?: string,
  ) {
    super(kind);
  }
}

/** Takes a ticket. The same idempotency key is reused on retries, so a dropped answer never creates a second ticket. */
export async function issueAtKiosk(
  token: string,
  body: { reasonId: string; language: string; fields: Record<string, string>; consent: boolean },
  idempotencyKey: string,
): Promise<KioskTicket> {
  let res: Response;
  try {
    res = await fetch("/api/v1/kiosk/tickets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new KioskError("network");
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as KioskTicket;
  const code = data?.error?.code as string | undefined;
  const details = (data?.error?.details ?? {}) as { reason?: string; field?: string };
  if (res.status === 401) throw new KioskError("unauthorized");
  if (code === "rate_limited") throw new KioskError("rate_limited");
  if (details.reason === "queue_full") throw new KioskError("queue_full");
  if (details.reason === "ask_staff") throw new KioskError("ask_staff");
  if (details.reason === "kiosk_disabled") throw new KioskError("disabled");
  if (details.reason === "invalid_field" && details.field === "phone") throw new KioskError("invalid_phone");
  if (details.reason === "missing_field") throw new KioskError("missing_field", details.field);
  if (res.status >= 500) throw new KioskError("network");
  throw new KioskError("other");
}

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
