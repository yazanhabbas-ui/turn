"use client";

import { Building2, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { applyDigits, toWesternDigits } from "@/domain/i18n/digits";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { T } from "./text";
import type { ConnectionState, DisplayState } from "./use-display";

export type Call = { ticketId: string; displayNumber: string; deskNumber: string | null; at: number; recall: boolean };

export type LayoutProps = {
  state: DisplayState;
  lang: "ar" | "en";
  t: T;
  /** The most recent call, if it just happened (drives the flash + chime highlight). */
  call: Call | null;
  flashing: boolean;
  clockOffset: number;
  connection: ConnectionState;
  soundOn: boolean;
};

/** Clock and dates in the branch time zone, with the configured digits, 12/24 h and optional Hijri date. */
export function useClock(state: DisplayState, lang: string, clockOffset: number) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const { timezone } = state.branch;
  const { digitsScreen, timeFormat, showHijri } = state.regional;
  const nu = digitsScreen === "arab" ? "arab" : "latn";
  return useMemo(() => {
    const at = new Date(tick + clockOffset);
    const tag = `${lang === "ar" ? "ar-SA" : "en-GB"}-u-nu-${nu}`;
    const time = new Intl.DateTimeFormat(tag, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: timeFormat === "12h",
    }).format(at);
    const date = new Intl.DateTimeFormat(`${lang === "ar" ? "ar-SA" : "en-GB"}-u-ca-gregory-nu-${nu}`, {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(at);
    const hijri = showHijri
      ? new Intl.DateTimeFormat(`${lang === "ar" ? "ar-SA" : "en-GB"}-u-ca-islamic-umalqura-nu-${nu}`, {
          timeZone: timezone,
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(at)
      : null;
    return { time, date, hijri };
  }, [tick, clockOffset, timezone, timeFormat, showHijri, nu, lang]);
}

/** Digits of a text in Western form, to tell whether a desk name only repeats its number ("Desk 3" / "المكتب ٣"). */
const digitsOf = (s: string) => toWesternDigits(s).replace(/[^0-9]/g, "");

export const num = (n: number | string, state: DisplayState) => applyDigits(String(n), state.regional.digitsScreen);

export function Header({ state, lang, t, connection, soundOn, clockOffset }: LayoutProps) {
  const clock = useClock(state, lang, clockOffset);
  const { branding, display } = state;
  return (
    <header className="flex items-center gap-6 px-[3vw] py-[1.6vh]">
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local logo of unknown size on a kiosk
        <img
          src={branding.logoUrl}
          alt=""
          className="h-[7vh] max-w-[16vw] rounded-[1vh] bg-white/95 object-contain px-[0.8vh] py-[0.5vh]"
        />
      ) : (
        <span className="bg-brand grid size-[7vh] place-items-center rounded-2xl text-white">
          <Building2 className="size-[4vh]" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[3.2vh] leading-tight font-bold">{pickText(branding.companyName, lang)}</h1>
        <p className="truncate text-[2vh] text-neutral-400">{pickText(state.branch.name, lang)}</p>
      </div>
      {display.config.showClock && (
        <div className="text-end">
          <div className="text-[5vh] leading-none font-bold tabular-nums" dir="ltr">
            {clock.time}
          </div>
          <div className="mt-1 text-[1.9vh] text-neutral-400">
            <bdi>{clock.date}</bdi>
            {clock.hijri && <bdi className="ms-4">{clock.hijri}</bdi>}
          </div>
        </div>
      )}
      <StatusDots t={t} connection={connection} soundOn={soundOn} />
    </header>
  );
}

function StatusDots({ t, connection, soundOn }: Pick<LayoutProps, "t" | "connection" | "soundOn">) {
  return (
    <div className="flex flex-col items-center gap-1 text-neutral-500">
      {connection === "connected" ? (
        <Wifi className="size-[2.6vh]" aria-label={t("connected")} />
      ) : (
        <span className="flex items-center gap-1 text-[1.6vh] text-amber-400">
          <WifiOff className="size-[2.6vh]" aria-hidden />
          {connection === "offline" ? t("offline") : t("reconnecting")}
        </span>
      )}
      {soundOn ? (
        <Volume2 className="size-[2.6vh]" aria-label={t("soundOn")} />
      ) : (
        <VolumeX className="size-[2.6vh] text-amber-400" aria-label={t("soundOff")} />
      )}
    </div>
  );
}

/** The big "now serving" number. Flashes and scales while a fresh call is announced. */
export function NowServing({
  state,
  lang,
  t,
  call,
  flashing,
  size = "hero",
}: Pick<LayoutProps, "state" | "lang" | "t" | "call" | "flashing"> & { size?: "hero" | "xl" }) {
  const latest = state.recent[0];
  const number = call?.displayNumber ?? latest?.displayNumber ?? null;
  const desk = call ? call.deskNumber : (latest?.deskNumber ?? null);
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex h-full flex-col items-center justify-center rounded-[2vh] border-2 border-neutral-800 bg-neutral-900 p-[2vh] text-center transition-colors",
        flashing && "dor-flash border-amber-400 bg-amber-400/10",
      )}
    >
      <p className="text-[3vh] font-medium text-neutral-400">{t("nowServing")}</p>
      {number ? (
        <>
          <p
            key={call?.at ?? "idle"}
            className={cn(
              "leading-none font-black tabular-nums",
              size === "xl" ? "my-[3vh] text-[min(34vh,26vw)]" : "my-[1vh] text-[min(14vh,10vw)]",
              flashing ? "dor-pop text-amber-300" : "text-white",
            )}
            dir="ltr"
          >
            {num(number, state)}
          </p>
          {desk && (
            <p className={cn("font-bold text-neutral-100", size === "xl" ? "text-[9vh]" : "text-[5vh]")}>
              {t("desk")} <span className="text-brand-accent tabular-nums">{num(desk, state)}</span>
            </p>
          )}
        </>
      ) : (
        <p className="my-[4vh] text-[4vh] text-neutral-500">{pickText(state.branding.welcomeText, lang)}</p>
      )}
    </section>
  );
}

/** One row per desk: desk number, the ticket it is calling or serving. */
export function DeskList({ state, lang, t, call, flashing }: Pick<LayoutProps, "state" | "lang" | "t" | "call" | "flashing">) {
  if (!state.desks.length) return null;
  return (
    <ul
      className="grid auto-rows-fr gap-[1vh]"
      style={{ gridTemplateRows: `repeat(${Math.min(state.desks.length, 8)}, minmax(0, 1fr))` }}
    >
      {state.desks.slice(0, 8).map((d) => {
        const hot = flashing && !!call && d.ticketId === call.ticketId;
        return (
          <li
            key={d.id}
            className={cn(
              "flex items-center gap-[2vw] rounded-[1.4vh] border border-neutral-800 bg-neutral-900 px-[2vw]",
              d.status === "called" && "border-amber-500/60",
              hot && "dor-flash border-amber-400 bg-amber-400/10",
            )}
          >
            <span className="min-w-[10vw] text-[3.4vh] font-semibold text-neutral-300">
              {t("desk")} <span className="text-white tabular-nums">{num(d.number, state)}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-[2vh] text-neutral-500">
              {digitsOf(pickText(d.name, lang)) === digitsOf(d.number) ? "" : pickText(d.name, lang)}
            </span>
            {d.displayNumber ? (
              <span
                className={cn(
                  "text-[6vh] leading-none font-black tabular-nums",
                  d.status === "called" ? "text-amber-300" : "text-emerald-400",
                )}
                dir="ltr"
              >
                {num(d.displayNumber, state)}
                {d.otherNumbers.length > 0 && (
                  <span className="ms-3 text-[3.4vh] font-bold text-neutral-400">
                    {d.otherNumbers.map((n) => num(n, state)).join(" · ")}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[2.4vh] text-neutral-600">{t("free")}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RecentCalls({
  state,
  t,
  className,
  max = 4,
}: Pick<LayoutProps, "state" | "t"> & { className?: string; max?: number }) {
  const items = state.recent.slice(1, 1 + max);
  if (!items.length) return null;
  return (
    <section className={className}>
      <h2 className="mb-[1vh] text-[2.4vh] font-medium text-neutral-400">{t("recent")}</h2>
      <ul className="flex flex-wrap gap-[1.2vh]">
        {items.map((r) => (
          <li
            key={`${r.ticketId}-${r.calledAt}`}
            className="rounded-[1.2vh] bg-neutral-900 px-[1.6vw] py-[1vh] text-[3vh] font-bold tabular-nums"
          >
            <span dir="ltr">{num(r.displayNumber, state)}</span>
            {r.deskNumber && (
              <span className="ms-3 text-[2.2vh] font-medium text-neutral-400">
                {t("desk")} {num(r.deskNumber, state)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** People waiting and the estimated wait for each visit reason. */
export function WaitingBoard({
  state,
  lang,
  t,
  className,
  rows = 6,
}: Pick<LayoutProps, "state" | "lang" | "t"> & { className?: string; rows?: number }) {
  if (!state.display.config.showWaiting) return null;
  return (
    <section className={className}>
      <h2 className="mb-[1vh] flex items-baseline justify-between text-[2.4vh] font-medium text-neutral-400">
        <span>{t("waiting")}</span>
        <span className="text-[3vh] font-bold text-white tabular-nums">{num(state.waitingTotal, state)}</span>
      </h2>
      <ul className="grid gap-[1vh]">
        {state.reasons.slice(0, rows).map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-[1.2vh] bg-neutral-900 px-[1.4vw] py-[1vh]">
            <span className="size-[2.4vh] shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[2.4vh]">{pickText(r.name, lang)}</span>
            <span className="text-[3vh] font-bold tabular-nums">{num(r.waiting, state)}</span>
            <span className="w-[9vw] text-end text-[1.9vh] text-neutral-400">
              {r.waiting > 0 ? t("minutes", { count: num(r.estimatedWaitMinutes, state) }) : t("noWait")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Scrolling announcement line. Direction follows the reading direction; pauses nothing, needs no interaction. */
export function Ticker({ state, lang }: Pick<LayoutProps, "state" | "lang">) {
  const lines = state.ticker.map((x) => pickText(x.body, lang)).filter(Boolean);
  if (!lines.length) return null;
  const text = lines.join("   •   ");
  const seconds = Math.max(20, Math.round(text.length * 0.28));
  const rtl = lang === "ar";
  return (
    <footer className="overflow-hidden border-t border-neutral-800 bg-neutral-900 py-[1.4vh]" dir={rtl ? "rtl" : "ltr"}>
      <div
        className="flex w-max gap-[8vw] text-[3vh] whitespace-nowrap"
        style={{ animation: `${rtl ? "dor-marquee-rtl" : "dor-marquee-ltr"} ${seconds}s linear infinite` }}
      >
        <span>{text}</span>
        <span aria-hidden>{text}</span>
      </div>
    </footer>
  );
}

/** Rotating slides (image and/or text) shown in the multi-zone layout. */
export function Slides({ state, lang, className }: Pick<LayoutProps, "state" | "lang"> & { className?: string }) {
  const slides = state.slides;
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const current = slides[count ? index % count : 0];
  useEffect(() => {
    if (count < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), (current?.durationSeconds ?? 10) * 1000);
    return () => clearTimeout(id);
  }, [index, count, current?.durationSeconds]);

  return (
    <section className={cn("relative overflow-hidden rounded-[2vh] border border-neutral-800 bg-neutral-900", className)}>
      {current ? (
        <div key={current.id} className="dor-fade absolute inset-0 grid place-items-center">
          {current.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- admin-supplied local image of unknown size
            <img src={current.mediaUrl} alt="" className="absolute inset-0 size-full object-cover" />
          )}
          {pickText(current.body, lang) && (
            <p
              className={cn(
                "relative z-10 max-w-[90%] text-center text-[4.4vh] leading-snug font-bold",
                current.mediaUrl && "rounded-[1.4vh] bg-black/60 px-[2vw] py-[1.6vh]",
              )}
            >
              {pickText(current.body, lang)}
            </p>
          )}
        </div>
      ) : (
        <p className="grid h-full place-items-center px-[2vw] text-center text-[4vh] font-semibold text-neutral-400">
          {pickText(state.branding.welcomeText, lang)}
        </p>
      )}
    </section>
  );
}
