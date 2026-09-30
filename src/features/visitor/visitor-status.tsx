"use client";

import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { EntityIcon } from "@/components/app/entity-icon";
import { pickText } from "@/i18n/locales";
import { waitLine, type WaitDisplay } from "../queue/wait-text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PublicStatus = {
  displayNumber: string;
  status: "APPOINTMENT_PENDING" | "WAITING" | "CALLED" | "SERVING" | "ON_HOLD" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  language: string;
  reason: { name: Record<string, string>; color: string; icon: string } | null;
  branch: Record<string, string>;
  desk: { number: string; name: Record<string, string> } | null;
  position: { ahead: number; estimatedWaitMinutes: number; waitLow?: number; waitHigh?: number } | null;
  waitDisplay: WaitDisplay;
};

/** Mobile page behind the ticket QR code. Polls every 10 s (no login, no personal data). */
export function VisitorStatus({ token, initial }: { token: string; initial: PublicStatus }) {
  const t = useTranslations("visitorStatus");
  const locale = useLocale();
  const { data } = useQuery({
    queryKey: ["visitor-status", token],
    queryFn: () => api<PublicStatus>(`/api/v1/public/tickets/${token}`),
    initialData: initial,
    refetchInterval: (q) => (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(q.state.data?.status ?? "") ? false : 10_000),
  });
  const s = data ?? initial;
  const called = s.status === "CALLED";
  const wait = s.position ? waitLine(s.position, s.waitDisplay, locale) : null;

  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center px-5 py-10 text-center transition-colors",
        called && "bg-status-called/10",
      )}
    >
      <p className="text-muted-foreground text-sm">{pickText(s.branch, locale)}</p>
      {s.reason && (
        <div className="mt-4 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg text-white" style={{ backgroundColor: s.reason.color }}>
            <EntityIcon name={s.reason.icon} className="size-5" />
          </span>
          <span className="font-medium">{pickText(s.reason.name, locale)}</span>
        </div>
      )}
      <h1 className="text-muted-foreground mt-8 text-sm font-medium">{t("title")}</h1>
      <p className="text-brand tabular mt-1 text-7xl font-bold" dir="ltr">
        {s.displayNumber}
      </p>

      {s.status === "WAITING" && s.position && (
        <div className="mt-8 w-full max-w-sm">
          <div className={cn("grid gap-3", wait ? "grid-cols-2" : "grid-cols-1")}>
            <div className="bg-card rounded-2xl border p-4 shadow-sm">
              <div className="text-muted-foreground text-xs">{t("ahead")}</div>
              <div className="tabular text-4xl font-bold">{s.position.ahead}</div>
            </div>
            {wait && (
              <div className="bg-card rounded-2xl border p-4 shadow-sm">
                <div className="text-muted-foreground text-xs">{wait.label}</div>
                <div className={cn("tabular font-bold", wait.next ? "text-2xl leading-[2.5rem]" : "text-4xl")}>
                  <bdi>{wait.value}</bdi>
                </div>
              </div>
            )}
          </div>
          {wait?.disclaimer && <p className="text-muted-foreground mt-2 text-xs">{wait.disclaimer}</p>}
        </div>
      )}

      <div role="status" aria-live="polite" className="mt-8 max-w-sm text-lg">
        {s.status === "WAITING" && t("waiting")}
        {called && (
          <div className="space-y-3">
            <BellRing className="text-status-called mx-auto size-12 animate-bounce" aria-hidden />
            <p className="text-2xl font-bold">{t("called")}</p>
            <p className="text-status-called text-4xl font-bold">{s.desk ? pickText(s.desk.name, locale) : ""}</p>
          </div>
        )}
        {s.status === "SERVING" && t("serving")}
        {s.status === "COMPLETED" && t("finished")}
        {s.status === "ON_HOLD" && t("onHold")}
        {s.status === "CANCELLED" && t("cancelled")}
        {s.status === "NO_SHOW" && t("noShow")}
      </div>
      <p className="text-muted-foreground mt-auto pt-10 text-xs">{t("refreshes")}</p>
    </main>
  );
}
