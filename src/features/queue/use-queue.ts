"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api";

/**
 * One Socket.IO connection per browser tab, shared by every hook. It reconnects on its own (with back-off) and
 * falls back to HTTP long-polling when WebSockets are blocked. The server is the source of truth: events only tell
 * the page to refetch.
 */
let shared: Socket | null = null;
function socket(): Socket {
  shared ??= io({ path: "/socket.io", transports: ["websocket", "polling"], reconnectionDelayMax: 5000 });
  return shared;
}

export type CalledEvent = {
  ticketId: string;
  displayNumber: string;
  deskNumber: string | null;
  agentId: string;
  reasonId: string;
  language: string;
  recall: boolean;
};

export type ConnectionState = "connected" | "connecting" | "offline";

/** Subscribes to a branch's events. Returns the connection state for the status pill and polling fallback. */
export function useBranchEvents(
  branchId: string | null | undefined,
  handlers: { onQueue?: () => void; onCalled?: (e: CalledEvent) => void; onAgent?: () => void },
): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!branchId) return;
    const s = socket();
    const subscribe = () => s.emit("subscribe", { branchId });
    const onConnect = () => {
      setState("connected");
      subscribe();
      // Anything may have changed while we were disconnected.
      ref.current.onQueue?.();
    };
    const onDisconnect = () => setState(navigator.onLine ? "connecting" : "offline");
    const onQueue = () => ref.current.onQueue?.();
    const onCalled = (e: CalledEvent) => ref.current.onCalled?.(e);
    const onAgent = () => ref.current.onAgent?.();
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onDisconnect);
    s.on("queue.updated", onQueue);
    s.on("ticket.called", onCalled);
    s.on("agent.updated", onAgent);
    if (s.connected) onConnect();
    return () => {
      s.emit("unsubscribe", { branchId });
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onDisconnect);
      s.off("queue.updated", onQueue);
      s.off("ticket.called", onCalled);
      s.off("agent.updated", onAgent);
    };
  }, [branchId]);

  return state;
}

/** Coalesces bursts of events (one issue may emit several) into a single refetch. */
function useDebounced(fn: () => void, ms = 150) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return () => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(fn, ms);
  };
}

/**
 * A query that refetches when branch events arrive. While the socket is down it polls every 5 s so the screen never
 * goes stale; while connected it only does a slow safety refetch.
 */
export function useLiveQuery<T>(key: unknown[], path: string | null, branchId: string | null | undefined) {
  const qc = useQueryClient();
  const refetch = useDebounced(() => qc.invalidateQueries({ queryKey: key }));
  const connection = useBranchEvents(branchId, { onQueue: refetch, onAgent: refetch, onCalled: refetch });
  const query = useQuery<T>({
    queryKey: key,
    queryFn: () => api<T>(path!),
    enabled: !!path,
    refetchInterval: connection === "connected" ? 60_000 : 5_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
  return { ...query, connection };
}
