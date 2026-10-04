"use client";

import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, CircleSlash, Hourglass, PauseCircle, Phone, RefreshCw, UserRoundCheck } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { brandHero } from "@/domain/branding/hero";
import { pickText } from "@/i18n/locales";
import { waitLine, type WaitDisplay } from "../queue/wait-text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FeedbackCard, type FeedbackCardConfig } from "./feedback-card";
import { NotifyOptIn } from "./notify-optin";

export type PublicStatus = {
  displayNumber: string;
  /** Last digits of the visitor's phone when the branch calls by them (the screens and the voice say these). */
  callCode?: string | null;
  status: "APPOINTMENT_PENDING" | "WAITING" | "CALLED" | "SERVING" | "ON_HOLD" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  language: string;
  /** The organization's look: logo, name and colours. */
  branding?: {
    companyName: Record<string, string>;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    primaryColor: string;
    accentColor: string;
  };
  reason: { name: Record<string, string>; color: string; icon: string } | null;
  branch: Record<string, string>;
  desk: { number: string; name: Record<string, string> } | null;
  /** The hall the visitor's group was called to; null for desk visits. */
  hall?: { number: string; name: Record<string, string> } | null;
  /** The visit is received with a group in a hall. */
  groupVisit?: boolean;
  position: { ahead: number; estimatedWaitMinutes: number; waitLow?: number; waitHigh?: number } | null;
  waitDisplay: WaitDisplay;
  /** Rating card for a completed visit (null when feedback is off or the visit is not completed). */
  feedback?: FeedbackCardConfig | null;
  /** The card is also shown on the status page itself (not only behind the feedback link). */
  feedbackOnPage?: boolean;
  /** Offer "get updates on my phone": the ticket has no phone yet and a messaging channel is available. */
  notifyOptIn?: boolean;
};

type Status = PublicStatus["status"];

/** Where the visit is on the way: waiting, called, being served, done. Cancelled and no-show are not on that way. */
const STEP_OF: Record<Status, number> = {
  APPOINTMENT_PENDING: 0,
  WAITING: 0,
  ON_HOLD: 0,
  CALLED: 1,
  SERVING: 2,
  COMPLETED: 3,
  CANCELLED: -1,
  NO_SHOW: -1,
};
const STEPS = ["waiting", "called", "serving", "done"] as const;

/** Mobile page behind the ticket QR code. Polls every 10 s (no login, no personal data). */
export function VisitorStatus({
  token,
  initial,
  focusFeedback = false,
}: {
  token: string;
  initial: PublicStatus;
  /** Opened from the feedback link: show the card even when the status page hides it, and focus it. */
  focusFeedback?: boolean;
}) {
  const t = useTranslations("visitorStatus");
  const locale = useLocale();
  const format = useFormatter();
  const { data, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["visitor-status", token],
    queryFn: () => api<PublicStatus>(`/api/v1/public/tickets/${token}`),
    initialData: initial,
    refetchInterval: (q) => (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(q.state.data?.status ?? "") ? false : 10_000),
  });
  const s = data ?? initial;
  const brand = brandHero(s.branding ?? {});
  const called = s.status === "CALLED";
  const wait = s.position ? waitLine(s.position, s.waitDisplay, locale) : null;
  const finished = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(s.status);
  const where = s.hall ? `${s.hall.number} ${pickText(s.hall.name, locale)}`.trim() : s.desk ? pickText(s.desk.name, locale) : "";
  const company = s.branding ? pickText(s.branding.companyName, locale) : "";
  const logo = s.branding?.logoUrl ?? s.branding?.logoDarkUrl ?? null;

  // The visitor may have the phone in a pocket: buzz once when the turn comes, and let the browser tab say so too.
  const before = useRef<Status>(initial.status);
  useEffect(() => {
    if (called && before.current !== "CALLED" && "vibrate" in navigator) navigator.vibrate?.([300, 120, 300, 120, 500]);
    before.current = s.status;
    document.title = `${called ? "🔔 " : ""}${t("title")} ${s.callCode ?? s.displayNumber}`;
  }, [called, s.status, s.callCode, s.displayNumber, t]);

  return (
    <main
      className={cn(
        "min-h-dvh pb-[max(2rem,env(safe-area-inset-bottom))] transition-colors duration-500",
        called ? "bg-status-called/10" : "bg-background",
      )}
    >
      <header className="rounded-b-[2rem] px-5 pt-6 pb-16 shadow-lg" style={{ background: brand.hero, color: brand.on }}>
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          {logo ? (
            <span className="inline-flex h-12 items-center rounded-xl bg-white px-3 shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt={company} className="h-8 w-auto" />
            </span>
          ) : (
            <span className="flex items-center gap-2 text-lg font-bold">
              <span
                className="grid size-10 place-items-center rounded-xl bg-white shadow-md"
                style={{ color: brand.primary }}
                aria-hidden
              >
                {company.slice(0, 1)}
              </span>
              {company}
            </span>
          )}
          <span
            className="max-w-[55%] truncate rounded-full px-3 py-1.5 text-base font-semibold"
            style={{ backgroundColor: `${brand.on}1f` }}
          >
            {pickText(s.branch, locale)}
          </span>
        </div>
      </header>

      <div className="mx-auto -mt-10 max-w-md space-y-4 px-4">
        <section className="bg-card rounded-3xl border p-5 text-center shadow-lg">
          {s.reason && (
            <div className="flex items-center justify-center gap-2">
              <span className="grid size-9 place-items-center rounded-lg text-white" style={{ backgroundColor: s.reason.color }}>
                <EntityIcon name={s.reason.icon} className="size-5" />
              </span>
              <span className="text-lg font-semibold">{pickText(s.reason.name, locale)}</span>
            </div>
          )}
          <h1 className="text-muted-foreground mt-4 text-sm font-medium">{t("yourNumber")}</h1>
          <p
            className="tabular mx-auto mt-1 w-fit rounded-3xl border-4 px-6 py-2 text-6xl leading-tight font-extrabold"
            style={{ borderColor: brand.primary, backgroundColor: `color-mix(in srgb, ${brand.primary} 10%, transparent)` }}
            dir="ltr"
          >
            {s.displayNumber}
          </p>
          {s.callCode && !finished && (
            <div className="mt-4 rounded-2xl border border-dashed p-3">
              <p className="text-muted-foreground text-sm">{t("calledAs")}</p>
              <p className="tabular mt-1 inline-flex items-center gap-2 text-4xl font-extrabold" dir="ltr">
                <Phone className="size-6" style={{ color: brand.primary }} aria-hidden />
                {s.callCode}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{t("calledAsHint")}</p>
            </div>
          )}
        </section>

        {/* Where the visit is on its way. */}
        {STEP_OF[s.status] >= 0 && !called && <Progress step={STEP_OF[s.status]} brand={brand.primary} t={t} />}

        <section aria-live="polite" role="status">
          {s.status === "WAITING" && (
            <div className="space-y-3">
              {s.position && (
                <>
                  <div className={cn("grid gap-3", wait ? "grid-cols-2" : "grid-cols-1")}>
                    <div className="bg-card rounded-2xl border p-4 text-center shadow-sm">
                      <div className="text-muted-foreground text-xs">{t("ahead")}</div>
                      <div className="tabular mt-1 text-4xl font-bold">{s.position.ahead}</div>
                    </div>
                    {wait && (
                      <div className="bg-card rounded-2xl border p-4 text-center shadow-sm">
                        <div className="text-muted-foreground text-xs">{wait.label}</div>
                        <div className={cn("tabular mt-1 font-bold", wait.next ? "text-2xl leading-[2.5rem]" : "text-4xl")}>
                          <bdi>{wait.value}</bdi>
                        </div>
                      </div>
                    )}
                  </div>
                  {wait?.disclaimer && <p className="text-muted-foreground px-1 text-center text-xs">{wait.disclaimer}</p>}
                </>
              )}
              <p className="text-muted-foreground flex items-center justify-center gap-2 text-center text-lg">
                <Hourglass className="size-5 shrink-0" aria-hidden />
                {s.groupVisit ? t("waitingGroup") : t("waiting")}
              </p>
            </div>
          )}

          {called && (
            <div className="border-status-called bg-status-called/15 rounded-3xl border-2 p-6 text-center shadow-lg">
              <BellRing className="text-status-called mx-auto size-14 animate-bounce" aria-hidden />
              <p className="mt-2 text-2xl font-bold">{s.hall ? t("calledHall") : t("called")}</p>
              {where && <p className="text-status-called mt-2 text-5xl leading-tight font-extrabold">{where}</p>}
            </div>
          )}

          {s.status === "SERVING" && (
            <Notice icon={<UserRoundCheck className="text-status-serving size-8" aria-hidden />}>
              {s.hall ? t("servingHall", { hall: where }) : t("serving")}
              {!s.hall && where && <span className="mt-1 block text-2xl font-bold">{where}</span>}
            </Notice>
          )}
          {s.status === "COMPLETED" && (
            <Notice icon={<CheckCircle2 className="text-status-serving size-8" aria-hidden />}>{t("finished")}</Notice>
          )}
          {s.status === "ON_HOLD" && (
            <Notice icon={<PauseCircle className="text-status-hold size-8" aria-hidden />}>{t("onHold")}</Notice>
          )}
          {s.status === "CANCELLED" && (
            <Notice icon={<CircleSlash className="text-status-cancelled size-8" aria-hidden />}>{t("cancelled")}</Notice>
          )}
          {s.status === "NO_SHOW" && (
            <Notice icon={<CircleSlash className="text-status-noshow size-8" aria-hidden />}>{t("noShow")}</Notice>
          )}
        </section>

        {/* When called, the steps come after the "go to" card so that card is the first thing on the screen. */}
        {called && <Progress step={STEP_OF[s.status]} brand={brand.primary} t={t} />}

        {s.status === "COMPLETED" && s.feedback && (s.feedbackOnPage !== false || focusFeedback) && (
          <FeedbackCard token={token} config={s.feedback} autoFocus={focusFeedback} />
        )}
        {s.notifyOptIn && s.status === "WAITING" && <NotifyOptIn token={token} />}

        {!finished && (
          <div className="text-muted-foreground flex items-center justify-center gap-3 pt-2 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="bg-status-serving absolute inline-flex size-full animate-ping rounded-full opacity-60" />
                <span className="bg-status-serving relative inline-flex size-2 rounded-full" />
              </span>
              {t("updatedAt", { time: format.dateTime(new Date(dataUpdatedAt || Date.now()), { timeStyle: "short" }) })}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 outline-none focus-visible:ring-3"
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden />
              {t("refresh")}
            </button>
          </div>
        )}
        <p className="text-muted-foreground pb-2 text-center text-xs">{t("refreshes")}</p>
      </div>
    </main>
  );
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card flex items-center gap-4 rounded-2xl border p-5 text-lg shadow-sm">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 text-start">{children}</div>
    </div>
  );
}

/** Four steps from "waiting" to "done"; the finished ones are filled, the current one is ringed. */
function Progress({ step, brand, t }: { step: number; brand: string; t: ReturnType<typeof useTranslations> }) {
  return (
    <ol className="bg-card flex items-start rounded-2xl border px-3 py-4 shadow-sm" aria-label={t("title")}>
      {STEPS.map((key, i) => {
        const done = i < step || step === 3;
        const current = i === step && step !== 3;
        return (
          <li
            key={key}
            className="relative flex flex-1 flex-col items-center gap-1.5 text-center"
            aria-current={current ? "step" : undefined}
          >
            {i > 0 && (
              <span
                className="absolute inset-e-1/2 top-3.5 h-0.5 w-full -translate-y-1/2"
                style={{ backgroundColor: i <= step ? brand : "var(--border)" }}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-7 place-items-center rounded-full border-2 text-xs font-bold",
                current && "ring-4",
              )}
              style={{
                borderColor: done || current ? brand : "var(--border)",
                backgroundColor: done ? brand : "var(--card)",
                color: done ? "#fff" : brand,
                ["--tw-ring-color" as string]: `color-mix(in srgb, ${brand} 25%, transparent)`,
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={cn("text-xs", current ? "font-bold" : "text-muted-foreground")}>{t(`steps.${key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
