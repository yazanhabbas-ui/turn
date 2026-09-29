"use client";

import { Moon, Wifi, WifiOff } from "lucide-react";
import { useNow, useTranslations } from "next-intl";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "./use-queue";
import type { Paused, TicketStatus } from "./types";

/** Status colours are identical on every screen (tokens --status-*). */
const STATUS_CLASS: Record<TicketStatus, string> = {
  APPOINTMENT_PENDING: "bg-status-waiting/10 text-status-waiting border-status-waiting/30",
  WAITING: "bg-status-waiting/10 text-status-waiting border-status-waiting/30",
  CALLED: "bg-status-called/10 text-status-called border-status-called/40",
  SERVING: "bg-status-serving/10 text-status-serving border-status-serving/30",
  ON_HOLD: "bg-status-hold/10 text-status-hold border-status-hold/30",
  COMPLETED: "bg-status-done/10 text-status-done border-status-done/30",
  NO_SHOW: "bg-status-noshow/10 text-status-noshow border-status-noshow/30",
  CANCELLED: "bg-status-cancelled/10 text-status-cancelled border-status-cancelled/30",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations("ticketStatus");
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_CLASS[status])}>
      {t(status)}
    </span>
  );
}

/** "4:07" or "1:02:33". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Live-ticking elapsed time since an ISO timestamp. */
export function Elapsed({ since, className }: { since: string | null | undefined; className?: string }) {
  const now = useNow({ updateInterval: 1000 });
  if (!since) return null;
  return (
    <span className={cn("tabular", className)} dir="ltr">
      {formatElapsed(now.getTime() - new Date(since).getTime())}
    </span>
  );
}

/** SLA state of a wait: green below 80% of target, amber up to 100%, red beyond. */
export function slaLevel(waitedMs: number, slaMinutes: number): "ok" | "warn" | "breach" {
  const ratio = waitedMs / (slaMinutes * 60_000);
  return ratio >= 1 ? "breach" : ratio >= 0.8 ? "warn" : "ok";
}

export function SlaTimer({ since, slaMinutes, large }: { since: string; slaMinutes: number; large?: boolean }) {
  const t = useTranslations("queue");
  const now = useNow({ updateInterval: 1000 });
  const waited = now.getTime() - new Date(since).getTime();
  const level = slaLevel(waited, slaMinutes);
  const pct = Math.min(100, (waited / (slaMinutes * 60_000)) * 100);
  const color = level === "ok" ? "bg-sla-ok" : level === "warn" ? "bg-sla-warn" : "bg-sla-breach";
  const text = level === "ok" ? "text-sla-ok" : level === "warn" ? "text-sla-warn" : "text-sla-breach";
  return (
    <div className="space-y-1" role="timer" aria-label={t("sla", { min: slaMinutes })}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("tabular font-semibold", text, large ? "text-2xl" : "text-sm")} dir="ltr">
          {formatElapsed(waited)}
        </span>
        <span className="text-muted-foreground text-xs">{t("sla", { min: slaMinutes })}</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const t = useTranslations("queue");
  const label = state === "connected" ? t("live") : state === "offline" ? t("offline") : t("reconnecting");
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        state === "connected"
          ? "border-status-serving/30 text-status-serving"
          : "border-status-called/40 bg-status-called/10 text-status-called",
      )}
    >
      {state === "connected" ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
      {label}
      {state === "connected" && <span className="bg-status-serving size-1.5 animate-pulse rounded-full" aria-hidden />}
    </span>
  );
}

export function PauseBanner({ paused, locale }: { paused: Paused; locale: string }) {
  const t = useTranslations("queue");
  if (!paused) return null;
  return (
    <div
      role="status"
      className="border-status-hold/30 bg-status-hold/10 text-status-hold flex items-center gap-2 rounded-xl border px-4 py-3 font-medium"
    >
      <Moon className="size-5 shrink-0" aria-hidden />
      <span>{pickText(paused.message, locale) || t("paused", { name: pickText(paused.name, locale) })}</span>
    </div>
  );
}
