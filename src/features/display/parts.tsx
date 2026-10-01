"use client";

import { Building2, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { logoForTheme } from "@/domain/branding/surface-theme";
import { HALL_MAX_SHOWN } from "@/domain/display/config";
import { applyDigits, toWesternDigits } from "@/domain/i18n/digits";
import { pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { T } from "./text";
import type { ConnectionState, DisplayState } from "./use-display";

export type Call = {
  ticketId: string;
  displayNumber: string;
  deskNumber: string | null;
  at: number;
  recall: boolean;
  /** A group call to a hall: every number called and the hall (the single `displayNumber` is then the first). */
  hall?: { id: string; number: string; numbers: string[] };
};

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
  const logo = logoForTheme(display.theme ?? "dark", branding);
  return (
    <header className="flex items-center gap-6 px-[3vw] py-[1.6vh]">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local logo of unknown size on a kiosk
        <img src={logo} alt="" className="h-[7vh] max-w-[16vw] object-contain" />
      ) : (
        <span className="bg-brand grid size-[7vh] place-items-center rounded-2xl text-white">
          <Building2 className="size-[4vh]" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[3.2vh] leading-tight font-bold">{pickText(branding.companyName, lang)}</h1>
        <p className="text-dsp-muted truncate text-[2vh]">{pickText(state.branch.name, lang)}</p>
      </div>
      {display.config.showClock && (
        <div className="text-end">
          <div className="text-[5vh] leading-none font-bold tabular-nums" dir="ltr">
            {clock.time}
          </div>
          <div className="text-dsp-muted mt-1 text-[1.9vh]">
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
    <div className="text-dsp-subtle flex flex-col items-center gap-1">
      {connection === "connected" ? (
        <Wifi className="size-[2.6vh]" aria-label={t("connected")} />
      ) : (
        <span className="text-dsp-warn flex items-center gap-1 text-[1.6vh]">
          <WifiOff className="size-[2.6vh]" aria-hidden />
          {connection === "offline" ? t("offline") : t("reconnecting")}
        </span>
      )}
      {soundOn ? (
        <Volume2 className="size-[2.6vh]" aria-label={t("soundOn")} />
      ) : (
        <VolumeX className="text-dsp-warn size-[2.6vh]" aria-label={t("soundOff")} />
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
  // A group called to a hall is shown as one card: the hall and every number.
  const hall = call ? call.hall : hallOfRecent(state, latest);
  if (number && hall) {
    return (
      <section
        aria-live="polite"
        className={cn(
          "border-dsp-line bg-dsp-surface flex h-full flex-col items-center justify-center rounded-[2vh] border-2 p-[2vh] text-center transition-colors",
          flashing && "dor-flash border-dsp-hot-line bg-dsp-hot-bg",
        )}
      >
        <p className="text-dsp-muted text-[3vh] font-medium">{t("nowServing")}</p>
        <p className={cn("font-bold", size === "xl" ? "mt-[2vh] text-[9vh]" : "mt-[1vh] text-[5vh]")}>
          {t("hall")} <span className="text-dsp-accent tabular-nums">{num(hall.number, state)}</span>
        </p>
        <HallNumbers
          key={call?.at ?? "idle"}
          state={state}
          numbers={hall.numbers}
          hot={flashing}
          className={size === "xl" ? "my-[3vh] text-[min(14vh,10vw)]" : "my-[1vh] text-[min(8vh,6vw)]"}
        />
      </section>
    );
  }
  return (
    <section
      aria-live="polite"
      className={cn(
        "border-dsp-line bg-dsp-surface flex h-full flex-col items-center justify-center rounded-[2vh] border-2 p-[2vh] text-center transition-colors",
        flashing && "dor-flash border-dsp-hot-line bg-dsp-hot-bg",
      )}
    >
      <p className="text-dsp-muted text-[3vh] font-medium">{t("nowServing")}</p>
      {number ? (
        <>
          <p
            key={call?.at ?? "idle"}
            className={cn(
              "leading-none font-black tabular-nums",
              size === "xl" ? "my-[3vh] text-[min(34vh,26vw)]" : "my-[1vh] text-[min(14vh,10vw)]",
              flashing ? "dor-pop text-dsp-hot" : "text-dsp-strong",
            )}
            dir="ltr"
          >
            {num(number, state)}
          </p>
          {desk && (
            <p className={cn("text-dsp-text font-bold", size === "xl" ? "text-[9vh]" : "text-[5vh]")}>
              {t("desk")} <span className="text-dsp-accent tabular-nums">{num(desk, state)}</span>
            </p>
          )}
        </>
      ) : (
        <p className="text-dsp-subtle my-[4vh] text-[4vh]">{pickText(state.branding.welcomeText, lang)}</p>
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
              "border-dsp-line bg-dsp-surface flex items-center gap-[2vw] rounded-[1.4vh] border px-[2vw]",
              d.status === "called" && "border-dsp-called",
              hot && "dor-flash border-dsp-hot-line bg-dsp-hot-bg",
            )}
          >
            <span className="text-dsp-soft min-w-[10vw] text-[3.4vh] font-semibold">
              {t("desk")} <span className="text-dsp-strong tabular-nums">{num(d.number, state)}</span>
            </span>
            <span className="text-dsp-subtle min-w-0 flex-1 truncate text-[2vh]">
              {digitsOf(pickText(d.name, lang)) === digitsOf(d.number) ? "" : pickText(d.name, lang)}
            </span>
            {d.displayNumber ? (
              <span
                className={cn(
                  "text-[6vh] leading-none font-black tabular-nums",
                  d.status === "called" ? "text-dsp-hot" : "text-dsp-ok",
                )}
                dir="ltr"
              >
                {num(d.displayNumber, state)}
                {d.otherNumbers.length > 0 && (
                  <span className="text-dsp-muted ms-3 text-[3.4vh] font-bold">
                    {d.otherNumbers.map((n) => num(n, state)).join(" · ")}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-dsp-subtle text-[2.4vh]">{t("free")}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The numbers of the latest call when it went to a hall (the hall's current group, or just that ticket). */
function hallOfRecent(state: DisplayState, latest: DisplayState["recent"][number] | undefined) {
  if (!latest?.hallId || !latest.hallNumber) return null;
  const h = (state.halls ?? []).find((x) => x.id === latest.hallId);
  const numbers = h?.numbers.length ? h.numbers : [latest.displayNumber];
  return { id: latest.hallId, number: latest.hallNumber, numbers };
}

/** A group's numbers on one wrapping line: at most HALL_MAX_SHOWN, then "+k". */
function HallNumbers({
  state,
  numbers,
  hot,
  className,
}: {
  state: DisplayState;
  numbers: string[];
  hot?: boolean;
  className?: string;
}) {
  const shown = numbers.slice(0, HALL_MAX_SHOWN);
  const more = numbers.length - shown.length;
  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline justify-center gap-x-[1.4vw] gap-y-[0.6vh] leading-tight font-black tabular-nums",
        hot ? "dor-pop text-dsp-hot" : "text-dsp-strong",
        className,
      )}
      dir="ltr"
    >
      {shown.map((n) => (
        <span key={n}>{num(n, state)}</span>
      ))}
      {more > 0 && <span className="text-dsp-muted text-[0.6em]">+{num(more, state)}</span>}
    </p>
  );
}

/** One card per hall: hall number, the group called or inside, and (optionally) how full it is. */
export function HallList({ state, lang, t, call, flashing }: Pick<LayoutProps, "state" | "lang" | "t" | "call" | "flashing">) {
  const halls = state.halls ?? [];
  if (!halls.length) return null;
  const showOccupancy = state.display.config.showHallOccupancy !== false;
  return (
    <ul className="grid gap-[1vh]">
      {halls.slice(0, 4).map((h) => {
        const hot = flashing && call?.hall?.id === h.id;
        const name = pickText(h.name, lang);
        return (
          <li
            key={h.id}
            className={cn(
              "border-dsp-line bg-dsp-surface flex items-center gap-[2vw] rounded-[1.4vh] border px-[2vw] py-[1vh]",
              h.status === "called" && "border-dsp-called",
              hot && "dor-flash border-dsp-hot-line bg-dsp-hot-bg",
            )}
          >
            <span className="text-dsp-soft min-w-[10vw] text-[3.4vh] font-semibold">
              {t("hall")} <span className="text-dsp-strong tabular-nums">{num(h.number, state)}</span>
              {name && digitsOf(name) !== digitsOf(h.number) && (
                <span className="text-dsp-subtle block text-[2vh] font-normal">{name}</span>
              )}
            </span>
            {h.numbers.length ? (
              <HallNumbers
                state={state}
                numbers={h.numbers}
                className={cn(
                  "min-w-0 flex-1 justify-start text-[4.4vh]",
                  h.status === "called" ? "text-dsp-hot" : "text-dsp-ok",
                )}
              />
            ) : (
              <span className="text-dsp-subtle flex-1 text-[2.4vh]">{t("free")}</span>
            )}
            {showOccupancy && h.numbers.length > 0 && (
              <span className="text-dsp-muted text-[2.4vh] font-semibold tabular-nums" dir="ltr">
                {num(h.occupied, state)} / {num(h.capacity, state)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Desks, and under them the halls. A branch without halls shows exactly the desk list as before. */
export function Places(p: Pick<LayoutProps, "state" | "lang" | "t" | "call" | "flashing">) {
  if (!p.state.halls?.length) return <DeskList {...p} />;
  return (
    <div className="grid min-h-0 grid-rows-[1fr_auto] content-start gap-[1.4vh]">
      <DeskList {...p} />
      <HallList {...p} />
    </div>
  );
}

type RecentGroup = { key: string; numbers: string[]; deskNumber: string | null; hallNumber: string | null };

/** Recent calls with a group call collapsed into one entry. */
function recentGroups(recent: DisplayState["recent"]): RecentGroup[] {
  const groups: RecentGroup[] = [];
  for (const r of recent) {
    const key = r.hallSessionId ?? `${r.ticketId}-${r.calledAt}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.numbers.push(r.displayNumber);
    else groups.push({ key, numbers: [r.displayNumber], deskNumber: r.deskNumber, hallNumber: r.hallNumber ?? null });
  }
  return groups;
}

export function RecentCalls({
  state,
  t,
  className,
  max = 4,
}: Pick<LayoutProps, "state" | "t"> & { className?: string; max?: number }) {
  // The first group is the one shown as "now serving".
  const items = recentGroups(state.recent).slice(1, 1 + max);
  if (!items.length) return null;
  return (
    <section className={className}>
      <h2 className="text-dsp-muted mb-[1vh] text-[2.4vh] font-medium">{t("recent")}</h2>
      <ul className="flex flex-wrap gap-[1.2vh]">
        {items.map((r) => (
          <li key={r.key} className="bg-dsp-surface rounded-[1.2vh] px-[1.6vw] py-[1vh] text-[3vh] font-bold tabular-nums">
            <span dir="ltr">
              {r.numbers
                .slice(0, HALL_MAX_SHOWN)
                .map((n) => num(n, state))
                .join(" · ")}
              {r.numbers.length > HALL_MAX_SHOWN && ` +${num(r.numbers.length - HALL_MAX_SHOWN, state)}`}
            </span>
            {r.deskNumber && (
              <span className="text-dsp-muted ms-3 text-[2.2vh] font-medium">
                {t("desk")} {num(r.deskNumber, state)}
              </span>
            )}
            {r.hallNumber && (
              <span className="text-dsp-muted ms-3 text-[2.2vh] font-medium">
                {t("hall")} {num(r.hallNumber, state)}
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
      <h2 className="text-dsp-muted mb-[1vh] flex items-baseline justify-between text-[2.4vh] font-medium">
        <span>{t("waiting")}</span>
        <span className="text-dsp-strong text-[3vh] font-bold tabular-nums">{num(state.waitingTotal, state)}</span>
      </h2>
      <ul className="grid gap-[1vh]">
        {state.reasons.slice(0, rows).map((r) => (
          <li key={r.id} className="bg-dsp-surface flex items-center gap-3 rounded-[1.2vh] px-[1.4vw] py-[1vh]">
            <span className="size-[2.4vh] shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[2.4vh]">{pickText(r.name, lang)}</span>
            <span className="text-[3vh] font-bold tabular-nums">{num(r.waiting, state)}</span>
            <span className="text-dsp-muted w-[9vw] text-end text-[1.9vh]">
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
    <footer className="border-dsp-line bg-dsp-surface overflow-hidden border-t py-[1.4vh]" dir={rtl ? "rtl" : "ltr"}>
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
    <section className={cn("border-dsp-line bg-dsp-surface relative overflow-hidden rounded-[2vh] border", className)}>
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
                current.mediaUrl && "rounded-[1.4vh] bg-black/60 px-[2vw] py-[1.6vh] text-white",
              )}
            >
              {pickText(current.body, lang)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-dsp-muted grid h-full place-items-center px-[2vw] text-center text-[4vh] font-semibold">
          {pickText(state.branding.welcomeText, lang)}
        </p>
      )}
    </section>
  );
}
