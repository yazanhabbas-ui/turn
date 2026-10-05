"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  Hourglass,
  Mail,
  PauseCircle,
  Phone,
  RefreshCw,
  UserRoundCheck,
  Wifi,
} from "lucide-react";
import { useFormatter, useLocale } from "next-intl";
import { useEffect, useRef } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { InfoTip } from "@/components/ui/info-tip";
import { brandHero } from "@/domain/branding/hero";
import { PAGE_CONTENT_DEFAULTS, type VisitorPageContent } from "@/domain/pagecontent/schema";
import { isSafeHttpsUrl } from "@/domain/pagecontent/url";
import { pickText } from "@/i18n/locales";
import type { T } from "../display/text";
import { PageTextProvider, usePageText } from "../pagecontent/page-text";
import { waitLine, type WaitDisplay } from "../queue/wait-text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FeedbackCard, type FeedbackCardConfig } from "./feedback-card";

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
  /** Wording and options chosen for the page (D66); an older answer has none and the defaults apply. */
  pageContent?: VisitorPageContent;
  /** The free Wi-Fi block (only when the page shows it). */
  wifi?: {
    ssid: string;
    password: string;
    title: Record<string, string>;
    ssidLabel: Record<string, string>;
    passwordLabel: Record<string, string>;
  } | null;
};

/** The page options with every default filled in. */
export const visitorPageOf = (s: Pick<PublicStatus, "pageContent">): VisitorPageContent => ({
  ...PAGE_CONTENT_DEFAULTS.visitor,
  ...(s.pageContent ?? {}),
});

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
  const { data, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["visitor-status", token],
    queryFn: () => api<PublicStatus>(`/api/v1/public/tickets/${token}`),
    initialData: initial,
    refetchInterval: (q) => (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(q.state.data?.status ?? "") ? false : 10_000),
  });
  const s = data ?? initial;
  return (
    <PageTextProvider group="visitor" texts={s.pageContent?.texts}>
      <VisitorStatusView
        token={token}
        s={s}
        initialStatus={initial.status}
        focusFeedback={focusFeedback}
        live
        refetch={() => void refetch()}
        isFetching={isFetching}
        updatedAt={dataUpdatedAt}
      />
    </PageTextProvider>
  );
}

/**
 * The page itself, from a status answer. The live page feeds it from the server; the preview in Admin, Settings feeds
 * it a sample (with `live` off, so nothing vibrates and the tab title stays), so both draw exactly the same page.
 */
export function VisitorStatusView({
  token,
  s,
  initialStatus,
  focusFeedback = false,
  live = false,
  refetch,
  isFetching = false,
  updatedAt,
}: {
  token: string;
  s: PublicStatus;
  initialStatus?: Status;
  focusFeedback?: boolean;
  live?: boolean;
  refetch: () => void;
  isFetching?: boolean;
  updatedAt?: number;
}) {
  const locale = useLocale();
  const format = useFormatter();
  const page = visitorPageOf(s);
  const brand = brandHero(s.branding ?? {});
  const called = s.status === "CALLED";
  const wait = s.position && page.showEstimatedWait ? waitLine(s.position, s.waitDisplay, locale) : null;
  const finished = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(s.status);
  const rawWhere = s.hall
    ? `${s.hall.number} ${pickText(s.hall.name, locale)}`.trim()
    : s.desk
      ? pickText(s.desk.name, locale)
      : "";
  const where = page.showDeskCard ? rawWhere : "";
  const company = s.branding ? pickText(s.branding.companyName, locale) : "";
  const logo = page.showLogo ? (s.branding?.logoUrl ?? s.branding?.logoDarkUrl ?? null) : null;
  // Every wording of the page may use the ticket number, the branch, the service, the desk, the people ahead and the wait.
  const t = usePageText("visitor", {
    number: s.displayNumber,
    branch: pickText(s.branch, locale),
    reason: s.reason ? pickText(s.reason.name, locale) : "",
    desk: rawWhere,
    ahead: s.position ? String(s.position.ahead) : "",
    wait: wait ? (wait.next ? wait.value : `${wait.label}: ${wait.value}`) : "",
  });

  // The visitor may have the phone in a pocket: buzz once when the turn comes, and let the browser tab say so too.
  const before = useRef<Status>(initialStatus ?? s.status);
  useEffect(() => {
    if (!live) return;
    if (called && before.current !== "CALLED" && "vibrate" in navigator) navigator.vibrate?.([300, 120, 300, 120, 500]);
    before.current = s.status;
    document.title = `${called ? "🔔 " : ""}${t("title")} ${s.callCode ?? s.displayNumber}`;
  }, [live, called, s.status, s.callCode, s.displayNumber, t]);

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
          ) : page.showLogo ? (
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
          ) : (
            <span className="text-lg font-bold">{company}</span>
          )}
          {page.showBranch && (
            <span
              className="max-w-[55%] truncate rounded-full px-3 py-1.5 text-base font-semibold"
              style={{ backgroundColor: `${brand.on}1f` }}
            >
              {pickText(s.branch, locale)}
            </span>
          )}
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
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
                {t("calledAs")}
                <InfoTip>{t("calledAsHint")}</InfoTip>
              </p>
              <p className="tabular mt-1 inline-flex items-center gap-2 text-4xl font-extrabold" dir="ltr">
                <Phone className="size-6" style={{ color: brand.primary }} aria-hidden />
                {s.callCode}
              </p>
            </div>
          )}
        </section>

        {/* Where the visit is on its way. */}
        {STEP_OF[s.status] >= 0 && !called && <Progress step={STEP_OF[s.status]} brand={brand.primary} t={t} />}

        <section aria-live="polite" role="status">
          {s.status === "WAITING" && (
            <div className="space-y-3">
              {s.position && (page.showQueuePosition || wait) && (
                <>
                  <div className={cn("grid gap-3", wait && page.showQueuePosition ? "grid-cols-2" : "grid-cols-1")}>
                    {page.showQueuePosition && (
                      <div className="bg-card rounded-2xl border p-4 text-center shadow-sm">
                        <div className="text-muted-foreground text-xs">{t("ahead")}</div>
                        <div className="tabular mt-1 text-4xl font-bold">{s.position.ahead}</div>
                      </div>
                    )}
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
              {s.hall ? t("servingHall", { hall: rawWhere }) : t("serving")}
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
        {s.wifi && page.showWifi && !finished && <WifiCard wifi={s.wifi} locale={locale} />}
        <HelpBlock page={page} locale={locale} t={t} />

        {!finished && (
          <div className="text-muted-foreground flex items-center justify-center gap-3 pt-2 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="relative flex size-2">
                <span className="bg-status-serving absolute inline-flex size-full animate-ping rounded-full opacity-60" />
                <span className="bg-status-serving relative inline-flex size-2 rounded-full" />
              </span>
              {t("updatedAt", { time: format.dateTime(new Date(updatedAt || Date.now()), { timeStyle: "short" }) })}
            </span>
            <button
              type="button"
              onClick={refetch}
              disabled={isFetching}
              className="hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 outline-none focus-visible:ring-3"
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden />
              {t("refresh")}
            </button>
          </div>
        )}
        <p className="text-muted-foreground pb-2 text-center text-xs">{t("refreshes")}</p>
        {(page.footerText.ar || page.footerText.en) && (
          <p className="text-muted-foreground border-t pt-3 pb-2 text-center text-xs whitespace-pre-line">
            {pickText(page.footerText, locale)}
          </p>
        )}
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
function Progress({ step, brand, t }: { step: number; brand: string; t: T }) {
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

/** The branch's free Wi-Fi (Settings, Wi-Fi), when the page is set to show it. */
function WifiCard({ wifi, locale }: { wifi: NonNullable<PublicStatus["wifi"]>; locale: string }) {
  return (
    <section className="bg-card rounded-2xl border p-4 text-start shadow-sm">
      <p className="flex items-center gap-2 font-medium">
        <Wifi className="text-brand size-5" aria-hidden />
        {pickText(wifi.title, locale)}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{pickText(wifi.ssidLabel, locale)}</dt>
          <dd className="font-medium" dir="ltr">
            {wifi.ssid}
          </dd>
        </div>
        {wifi.password && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{pickText(wifi.passwordLabel, locale)}</dt>
            <dd className="font-medium" dir="ltr">
              {wifi.password}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Contact lines and up to three links the organization added. Links are https only (checked again here). */
function HelpBlock({ page, locale, t }: { page: VisitorPageContent; locale: string; t: T }) {
  const links = page.customLinks.filter((l) => isSafeHttpsUrl(l.url));
  if (!page.supportPhone && !page.supportEmail && links.length === 0) return null;
  const row =
    "hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm outline-none focus-visible:ring-3";
  return (
    <section className="bg-card rounded-2xl border p-3 text-start shadow-sm" aria-label={t("helpTitle")}>
      <p className="text-muted-foreground px-3 pt-1 pb-1 text-xs font-medium">{t("helpTitle")}</p>
      <ul>
        {page.supportPhone && (
          <li>
            <a className={row} href={`tel:${page.supportPhone.replace(/[^0-9+]/g, "")}`}>
              <Phone className="text-brand size-4 shrink-0" aria-hidden />
              <span dir="ltr">{page.supportPhone}</span>
            </a>
          </li>
        )}
        {page.supportEmail && (
          <li>
            <a className={row} href={`mailto:${page.supportEmail}`}>
              <Mail className="text-brand size-4 shrink-0" aria-hidden />
              <span dir="ltr">{page.supportEmail}</span>
            </a>
          </li>
        )}
        {links.map((l) => (
          <li key={l.url}>
            <a className={row} href={l.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="text-brand size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
              {pickText(l.label, locale)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
