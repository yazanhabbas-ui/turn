"use client";

import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, CircleAlert, Hand, Printer, WifiOff } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { brandHero } from "@/domain/branding/hero";
import { applyDigits } from "@/domain/i18n/digits";
import { PAGE_CONTENT_DEFAULTS, type KioskPageContent } from "@/domain/pagecontent/schema";
import { overrideOf } from "@/domain/pagecontent/text";
import { groupDigits, pressKey, type KeypadKey } from "@/domain/kiosk/keypad";
import { dirOf, pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { T } from "../display/text";
import { withVars } from "../pagecontent/make-t";
import { waitLine } from "../queue/wait-text";
import { Keypad } from "./keypad";
import type { KioskContext, KioskField, KioskReason, KioskTicket } from "./use-kiosk";

const BIG_BUTTON =
  "min-h-[4.5rem] rounded-2xl px-8 text-2xl font-bold transition active:scale-[0.98] disabled:opacity-50 portrait:min-h-[7vh] portrait:px-[5vw] portrait:text-[3.4vw]";

/**
 * The organization's look on the kiosk: its logo on a white plate (so any logo reads), a band in the brand colour with
 * the brand accent as a soft glow, and text that is white or near-black depending on how pale the colour is.
 */
export function brandOf(ctx: Pick<KioskContext, "branding">) {
  return brandHero(ctx.branding);
}

/** The kiosk's wording and options. A context cached by an older kiosk page has none: the defaults apply. */
export function pageOf(ctx: Pick<KioskContext, "pageContent">): KioskPageContent {
  return { ...PAGE_CONTENT_DEFAULTS.kiosk, ...(ctx.pageContent ?? {}) };
}

/** Wide screens: how many service tiles per row (a portrait screen always shows one column). */
const TILE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * The look of the band at the top of a screen: the organization's colour band ("brand") or a quiet header in the
 * screen's own colours ("plain"). Returns the styles of the band, of the chips and buttons on it.
 */
function headerLook(ctx: KioskContext) {
  const b = brandOf(ctx);
  if (pageOf(ctx).headerStyle === "plain") {
    return {
      plain: true,
      className: "bg-dsp-surface text-dsp-strong border-dsp-line border-b",
      style: {} as React.CSSProperties,
      chip: "color-mix(in srgb, currentColor 10%, transparent)",
      outline: "color-mix(in srgb, currentColor 40%, transparent)",
      text: undefined as string | undefined,
      active: { backgroundColor: b.primary, color: b.on, borderColor: b.primary } as React.CSSProperties,
    };
  }
  return {
    plain: false,
    className: "",
    style: { background: b.hero, color: b.on } as React.CSSProperties,
    chip: `${b.on}1f`,
    outline: `${b.on}66`,
    text: b.on as string | undefined,
    active: {
      backgroundColor: b.on,
      color: b.on === "#ffffff" ? b.primary : "#ffffff",
      borderColor: b.on,
    } as React.CSSProperties,
  };
}

/**
 * The frame every kiosk screen sits in: direction, theme (the same dark, light and brand looks as the waiting-room
 * screens of the branch) and the brand colours. The live kiosk and the preview in Admin both use it.
 */
export function KioskShell({
  lang,
  theme,
  branding,
  children,
}: {
  lang: string;
  theme: string | undefined;
  branding: { primaryColor?: string; accentColor?: string } | undefined;
  children: React.ReactNode;
}) {
  return (
    <div
      dir={dirOf(lang)}
      lang={lang}
      data-theme={theme ?? "dark"}
      className="dor-display min-h-dvh touch-manipulation overscroll-none select-none"
      style={{ "--dsp-primary": branding?.primaryColor, "--dsp-accent-brand": branding?.accentColor } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** The logo on a white plate; without a logo, the first letter of the name on the brand colour. */
function LogoPlate({ ctx, lang, size = "lg" }: { ctx: KioskContext; lang: string; size?: "lg" | "md" }) {
  const b = brandOf(ctx);
  const logo = ctx.branding.logoUrl ?? ctx.branding.logoDarkUrl;
  const name = pickText(ctx.branding.companyName, lang);
  return logo ? (
    <span className={cn("inline-flex items-center rounded-2xl bg-white px-5 shadow-lg", size === "lg" ? "h-20" : "h-14 px-4")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={name} className={cn("w-auto", size === "lg" ? "h-12" : "h-9")} />
    </span>
  ) : (
    <span className="inline-flex items-center gap-4">
      <span
        className={cn(
          "grid place-items-center rounded-2xl bg-white font-bold shadow-lg",
          size === "lg" ? "size-20 text-4xl" : "size-14 text-2xl",
        )}
        style={{ color: b.primary }}
        aria-hidden
      >
        {name.slice(0, 1)}
      </span>
      <span className={cn("font-bold", size === "lg" ? "text-4xl" : "text-2xl")}>{name}</span>
    </span>
  );
}

function LanguageButtons({
  ctx,
  lang,
  languages,
  t,
  onLang,
}: {
  ctx: KioskContext;
  lang: string;
  languages: string[];
  t: T;
  onLang: (l: string) => void;
}) {
  const look = headerLook(ctx);
  if (languages.length < 2 || !pageOf(ctx).showLanguageButtons) return null;
  return (
    <div className="flex gap-2" role="group" aria-label={t("language")}>
      {languages.map((l) => {
        const active = l === lang;
        return (
          <button
            key={l}
            type="button"
            onClick={() => onLang(l)}
            aria-pressed={active}
            lang={l}
            className="min-h-[3.5rem] min-w-[7rem] rounded-full border-2 px-6 text-xl font-semibold transition active:scale-95 portrait:min-h-[6vh] portrait:min-w-[17vw] portrait:text-[2.8vw]"
            style={active ? look.active : { color: look.text, borderColor: look.outline }}
          >
            {l === "ar" ? t("languageNameAr") : t("languageNameEn")}
          </button>
        );
      })}
    </div>
  );
}

export function Message({
  ctx,
  lang = "ar",
  icon,
  title,
  body,
  children,
}: {
  ctx?: KioskContext;
  lang?: string;
  icon?: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  const b = ctx ? brandOf(ctx) : null;
  return (
    <div className="bg-dsp-bg text-dsp-text grid min-h-dvh place-items-center p-8 text-center">
      <div className="max-w-2xl space-y-6 portrait:max-w-[88vw] portrait:space-y-[3vh]">
        {ctx && b && (
          <div className="mb-10 inline-block rounded-3xl p-5" style={{ background: b.hero, color: b.on }}>
            <LogoPlate ctx={ctx} lang={lang} />
          </div>
        )}
        {icon}
        <h1 className="text-dsp-strong text-4xl font-bold portrait:text-[6vw]">{title}</h1>
        {body && <p className="text-dsp-muted text-2xl portrait:text-[3.8vw]">{body}</p>}
        {children}
      </div>
    </div>
  );
}

export function Unavailable({ t, ctx, lang }: { t: T; ctx?: KioskContext; lang?: string }) {
  return (
    <Message
      ctx={ctx}
      lang={lang}
      icon={<Hand className="text-dsp-muted mx-auto size-20" aria-hidden />}
      title={t("unavailableTitle")}
      body={t("unavailableBody")}
    />
  );
}

export function Offline({ t, onRetry }: { t: T; onRetry: () => void }) {
  return (
    <Message
      icon={<WifiOff className="text-dsp-muted mx-auto size-20" aria-hidden />}
      title={t("offlineTitle")}
      body={t("offlineBody")}
    >
      <button type="button" onClick={onRetry} className={cn(BIG_BUTTON, "bg-dsp-strong text-dsp-bg")}>
        {t("retry")}
      </button>
    </Message>
  );
}

/** Welcome band with the logo, the language choice and the welcome text, then the services as large tiles. */
export function Home({
  ctx,
  lang,
  languages,
  t,
  onLang,
  onPick,
}: {
  ctx: KioskContext;
  lang: string;
  languages: string[];
  t: T;
  onLang: (l: string) => void;
  onPick: (r: KioskReason) => void;
}) {
  const page = pageOf(ctx);
  // The heading: the page-content text, else the welcome text of Self check-in, else the choose-a-service line itself.
  const welcome = overrideOf(page.texts, "welcome", lang) ? t("welcome") : pickText(ctx.options.welcomeText, lang, "");
  const look = headerLook(ctx);
  const Chevron = dirOf(lang) === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <div className="bg-dsp-bg text-dsp-text flex min-h-dvh flex-col">
      <header
        className={cn(
          "px-8 portrait:px-[5vw]",
          look.plain
            ? "py-8 shadow-sm portrait:py-[4vh]"
            : "rounded-b-[3rem] pt-8 pb-20 shadow-xl portrait:pt-[4vh] portrait:pb-[9vh]",
          look.className,
        )}
        style={look.style}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-8 portrait:max-w-none portrait:gap-[4vh]">
          <div className="flex items-center gap-6">
            {page.showLogo && <LogoPlate ctx={ctx} lang={lang} />}
            {page.showBranchName && (
              <span
                className="rounded-full px-5 py-2 text-2xl font-semibold portrait:text-[3vw]"
                style={{ backgroundColor: look.chip }}
              >
                {pickText(ctx.branch.name, lang)}
              </span>
            )}
            <div className="ms-auto">
              <LanguageButtons ctx={ctx} lang={lang} languages={languages} t={t} onLang={onLang} />
            </div>
          </div>
          <div className="space-y-3 text-center">
            <h1 className="text-6xl leading-tight font-extrabold tracking-tight portrait:text-[8vw]">
              {welcome || t("chooseService")}
            </h1>
            {welcome && <p className="text-3xl opacity-90 portrait:text-[4vw]">{t("chooseService")}</p>}
          </div>
        </div>
      </header>
      <main
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-8 pb-10 portrait:max-w-none portrait:px-[4vw] portrait:pb-[3vh]",
          look.plain ? "mt-8 portrait:mt-[3vh]" : "-mt-10 portrait:-mt-[5vh]",
        )}
      >
        <div
          className={cn(
            "grid content-start gap-5",
            TILE_COLUMNS[page.tilesPerRowLandscape] ?? TILE_COLUMNS[3],
            "portrait:flex-1 portrait:auto-rows-[minmax(11rem,1fr)] portrait:grid-cols-1! portrait:gap-[2.2vh]",
          )}
        >
          {ctx.reasons.map((r) => {
            const staff = r.state === "ask_staff";
            return (
              <button
                key={r.id}
                type="button"
                disabled={staff}
                onClick={() => onPick(r)}
                className={cn(
                  "bg-dsp-surface border-dsp-line text-dsp-strong flex min-h-[9rem] items-center gap-5 rounded-3xl border-2 p-6 text-start shadow-lg transition active:scale-[0.97] portrait:min-h-[11rem] portrait:gap-[3vw] portrait:p-[3vw]",
                  staff ? "[&>*]:opacity-55" : "hover:border-dsp-accent",
                )}
              >
                <span
                  className="grid size-24 shrink-0 place-items-center rounded-2xl text-white shadow-md portrait:size-[14vw]"
                  style={{ backgroundColor: r.color }}
                >
                  <EntityIcon name={r.icon} className="size-12 portrait:size-[7vw]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-3xl leading-tight font-bold portrait:text-[4.6vw]">{pickText(r.name, lang)}</span>
                  {page.showReasonDescriptions && r.description && (
                    <span className="text-dsp-muted mt-1 block text-xl leading-snug font-normal portrait:text-[3vw]">
                      {pickText(r.description, lang)}
                    </span>
                  )}
                  {staff && <span className="text-dsp-muted mt-2 block text-xl portrait:text-[3vw]">{t("askStaff")}</span>}
                </span>
                {!staff && <Chevron className="text-dsp-muted size-10 shrink-0 portrait:size-[6vw]" aria-hidden />}
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function fieldLabel(f: KioskField, lang: string, t: T) {
  const key = `field_${f.key}`;
  const own = t(key);
  return own !== key ? own : pickText(f.label, lang, f.key);
}

/** The few things a visitor may type for the chosen reason, a keypad for the phone, consent, and the big button. */
export function Form({
  ctx,
  reason,
  lang,
  t,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  ctx: KioskContext;
  reason: KioskReason;
  lang: string;
  t: T;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (fields: Record<string, string>, consent: boolean) => void;
}) {
  const digits = ctx.regional.digitsScreen;
  const b = brandOf(ctx);
  const look = headerLook(ctx);
  const page = pageOf(ctx);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [active, setActive] = useState<string | null>(reason.intakeFields.find((f) => f.key === "phone")?.key ?? null);
  const hasPhone = reason.intakeFields.some((f) => f.key === "phone");
  const filled = Object.values(values).some((v) => v.trim());
  const needsConsent = ctx.privacy.requireConsent && filled;
  const missing = reason.intakeFields.find((f) => f.required && !values[f.key]?.trim());
  const BackIcon = dirOf(lang) === "rtl" ? ArrowRight : ArrowLeft;
  const set = (key: string, v: string) => setValues((x) => ({ ...x, [key]: v }));

  return (
    <div className="bg-dsp-bg text-dsp-text flex min-h-dvh flex-col">
      <header
        className={cn(
          "px-8 py-6 portrait:px-[4vw] portrait:py-[3vh]",
          look.plain ? "shadow-sm" : "rounded-b-[2.5rem] shadow-xl",
          look.className,
        )}
        style={look.style}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-5 portrait:max-w-none portrait:gap-[2.5vw]">
          <button
            type="button"
            onClick={onBack}
            className={cn(BIG_BUTTON, "flex items-center gap-3 border-2")}
            style={{ borderColor: look.outline, color: look.text }}
          >
            <BackIcon className="size-8" aria-hidden />
            {t("back")}
          </button>
          <span
            className="grid size-16 place-items-center rounded-2xl bg-white/95 shadow-md portrait:size-[10vw]"
            style={{ color: reason.color }}
          >
            <EntityIcon name={reason.icon} className="size-9 portrait:size-[6vw]" />
          </span>
          <h1 className="text-4xl font-extrabold portrait:text-[5vw]">{pickText(reason.name, lang)}</h1>
          {page.showLogo && (
            <div className="ms-auto hidden sm:block">
              <LogoPlate ctx={ctx} lang={lang} size="md" />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-8 portrait:max-w-none portrait:gap-[2.5vh] portrait:p-[4vw]">
        <div
          className={cn(
            "grid flex-1 gap-8 portrait:grid-cols-1! portrait:content-between portrait:gap-[3vh]",
            hasPhone && "lg:grid-cols-[minmax(0,1fr)_22rem]",
          )}
        >
          <div className="space-y-5 portrait:space-y-[2.5vh]">
            {reason.intakeFields.map((f) => {
              const isPhone = f.key === "phone";
              return (
                <div key={f.key} className="space-y-2">
                  <label htmlFor={`k-${f.key}`} className="text-dsp-strong text-2xl font-semibold portrait:text-[3.6vw]">
                    {fieldLabel(f, lang, t)}
                    {f.required ? (
                      <span className="text-dsp-hot"> *</span>
                    ) : (
                      <span className="text-dsp-muted text-lg portrait:text-[2.8vw]"> ({t("optional")})</span>
                    )}
                  </label>
                  {isPhone ? (
                    <button
                      type="button"
                      id={`k-${f.key}`}
                      dir="ltr"
                      onClick={() => setActive("phone")}
                      className={cn(
                        "tabular bg-dsp-surface text-dsp-strong flex min-h-[5.5rem] w-full items-center justify-center rounded-2xl border-2 px-6 text-5xl tracking-widest portrait:min-h-[9vh] portrait:text-[7vw]",
                        active === "phone" ? "border-dsp-accent ring-dsp-ring ring-4" : "border-dsp-line",
                      )}
                    >
                      {values.phone ? (
                        applyDigits(groupDigits(values.phone), digits)
                      ) : (
                        <span className="text-dsp-subtle">{applyDigits(t("phonePlaceholder"), digits)}</span>
                      )}
                    </button>
                  ) : (
                    <input
                      id={`k-${f.key}`}
                      value={values[f.key] ?? ""}
                      onFocus={() => setActive(f.key)}
                      onChange={(e) => set(f.key, e.target.value)}
                      type={f.key === "email" ? "email" : "text"}
                      dir={f.key === "email" ? "ltr" : undefined}
                      autoComplete="off"
                      maxLength={120}
                      className="bg-dsp-surface text-dsp-strong border-dsp-line focus:border-dsp-accent focus:ring-dsp-ring min-h-[5rem] w-full rounded-2xl border-2 px-6 text-3xl outline-none focus:ring-4 portrait:min-h-[8vh] portrait:text-[4vw]"
                    />
                  )}
                </div>
              );
            })}
            {needsConsent && (
              <label className="bg-dsp-surface border-dsp-line flex items-start gap-4 rounded-2xl border p-5 text-xl portrait:gap-[3vw] portrait:p-[3vw] portrait:text-[3vw]">
                <input
                  type="checkbox"
                  className="mt-1 size-9 shrink-0 portrait:size-[6vw]"
                  style={{ accentColor: b.primary }}
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  <span className="text-dsp-strong mb-1 block font-semibold">{t("consentHeading")}</span>
                  {pickText(ctx.privacy.consentText, lang)}
                </span>
              </label>
            )}
            {error && (
              <p role="alert" className="text-dsp-hot flex items-center gap-3 text-2xl font-semibold portrait:text-[3.4vw]">
                <CircleAlert className="size-8 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </div>
          {hasPhone && (
            <div className="self-start portrait:self-stretch">
              <Keypad
                digits={digits}
                t={t}
                onKey={(k: KeypadKey) => {
                  setActive("phone");
                  set("phone", pressKey(values.phone ?? "", k));
                }}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy || !!missing || (needsConsent && !consent)}
          onClick={() => onSubmit(Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())), consent)}
          className={cn(BIG_BUTTON, "min-h-[5.5rem] w-full text-3xl shadow-xl portrait:min-h-[10vh] portrait:text-[4.6vw]")}
          style={b.actionStyle}
        >
          {busy ? t("issuing") : t("getNumber")}
        </button>
      </main>
    </div>
  );
}

/**
 * The ticket, as a ticket: a band with the logo, the big number, people ahead and the estimated wait, a perforated edge
 * and a QR to the status page, then the countdown back to the start.
 */
export function Result({
  ctx,
  result,
  reason,
  lang,
  t,
  onDone,
  onPrint,
}: {
  ctx: KioskContext;
  result: KioskTicket;
  reason: KioskReason | undefined;
  lang: string;
  t: T;
  onDone: () => void;
  onPrint: () => void;
}) {
  const digits = ctx.regional.digitsScreen;
  const b = brandOf(ctx);
  const look = headerLook(ctx);
  const page = pageOf(ctx);
  const simple = page.successStyle === "simple";
  const [qr, setQr] = useState<string | null>(null);
  const [left, setLeft] = useState(ctx.options.idleSeconds);
  const done = useRef(onDone);
  done.current = onDone;
  const url = useMemo(() => `${window.location.origin}/t/${result.ticket.publicToken}`, [result.ticket.publicToken]);

  useEffect(() => {
    if (!ctx.options.showQr) return;
    let cancelled = false;
    void QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then((d) => !cancelled && setQr(d));
    return () => {
      cancelled = true;
    };
  }, [ctx.options.showQr, url]);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0) done.current();
  }, [left]);

  const wait = ctx.options.showWait ? waitLine(result, ctx.waitDisplay, lang, digits) : null;
  const number = applyDigits(result.ticket.displayNumber, digits);
  // Every wording of this screen may use the ticket number, the branch, the service, the people ahead and the wait.
  const rt = withVars(t, {
    number,
    branch: pickText(ctx.branch.name, lang),
    reason: reason ? pickText(reason.name, lang) : "",
    ahead: applyDigits(String(result.ahead), digits),
    wait: wait ? (wait.next ? wait.value : `${wait.label}: ${wait.value}`) : "",
  });
  const numberBox = (
    <div>
      <p className="text-dsp-muted text-2xl portrait:text-[3.6vw]">{rt("yourNumber")}</p>
      <p
        className="text-dsp-strong tabular mx-auto mt-2 w-fit rounded-[2rem] border-4 px-10 py-4 text-[8.5rem] leading-none font-extrabold tracking-tight portrait:px-[5vw] portrait:py-[2vh] portrait:text-[21vw]"
        style={{ borderColor: b.primary, backgroundColor: `color-mix(in srgb, ${b.primary} 14%, transparent)` }}
        dir="ltr"
      >
        {number}
      </p>
    </div>
  );
  const aheadLine = (
    <p className="text-3xl portrait:text-[4.4vw]">
      {result.ahead > 0 ? rt("ahead", { count: applyDigits(String(result.ahead), digits) }) : rt("youAreNext")}
      {wait && (
        <span className="text-dsp-muted">
          {" · "}
          {wait.next ? (
            wait.value
          ) : (
            <>
              {wait.label}: <bdi>{wait.value}</bdi>
            </>
          )}
        </span>
      )}
    </p>
  );
  const qrBlock = qr && (
    <div className="flex items-center justify-center gap-6 px-8 py-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="" className="size-44 rounded-xl bg-white p-2 shadow-md portrait:size-[26vw]" />
      <p className="text-dsp-soft max-w-xs text-start text-2xl portrait:max-w-[42vw] portrait:text-[3.4vw]">{rt("scanQr")}</p>
    </div>
  );
  return (
    <div className="bg-dsp-bg text-dsp-text grid min-h-dvh place-items-center p-6 portrait:p-[4vw]">
      <div className="w-full max-w-3xl space-y-5 text-center portrait:max-w-none portrait:space-y-[3vh]">
        {result.duplicate && (
          <p className="bg-dsp-surface border-dsp-line mx-auto w-fit rounded-full border px-8 py-3 text-2xl portrait:text-[3.4vw]">
            {rt("duplicate")}
          </p>
        )}
        {simple ? (
          <div className="space-y-6">
            <p className="text-dsp-soft text-3xl font-semibold portrait:text-[4.6vw]">
              {reason ? pickText(reason.name, lang) : ""}
            </p>
            {numberBox}
            {aheadLine}
            {wait?.disclaimer && <p className="text-dsp-muted -mt-3 text-lg portrait:text-[2.8vw]">{wait.disclaimer}</p>}
            {qrBlock}
          </div>
        ) : (
          <div className="bg-dsp-surface border-dsp-line overflow-hidden rounded-[2rem] border shadow-2xl">
            <div className={cn("flex items-center justify-between gap-4 px-8 py-5", look.className)} style={look.style}>
              {page.showLogo ? <LogoPlate ctx={ctx} lang={lang} size="md" /> : <span />}
              {page.showBranchName && (
                <span className="text-xl font-medium portrait:text-[3vw]">{pickText(ctx.branch.name, lang)}</span>
              )}
            </div>
            <div className="space-y-6 px-8 pt-8 pb-6">
              <p className="text-dsp-soft text-3xl font-semibold portrait:text-[4.6vw]">
                {reason ? pickText(reason.name, lang) : ""}
              </p>
              {numberBox}
              {aheadLine}
              {wait?.disclaimer && <p className="text-dsp-muted -mt-3 text-lg portrait:text-[2.8vw]">{wait.disclaimer}</p>}
            </div>
            {qr && (
              <>
                {/* The perforated edge of a ticket. */}
                <div className="relative">
                  <span className="bg-dsp-bg absolute -start-4 -top-4 size-8 rounded-full" aria-hidden />
                  <span className="bg-dsp-bg absolute -end-4 -top-4 size-8 rounded-full" aria-hidden />
                  <div className="border-dsp-line mx-8 border-t-4 border-dashed" />
                </div>
                {qrBlock}
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-4">
          {ctx.options.printTicket && (
            <button
              type="button"
              onClick={onPrint}
              className={cn(BIG_BUTTON, "bg-dsp-surface border-dsp-line text-dsp-strong flex items-center gap-3 border-2")}
            >
              <Printer className="size-8" aria-hidden />
              {rt("print")}
            </button>
          )}
          <button type="button" onClick={onDone} className={cn(BIG_BUTTON, "shadow-xl")} style={b.actionStyle}>
            {rt("done")}
          </button>
        </div>
        <p className="text-dsp-muted text-xl portrait:text-[3vw]" aria-live="off">
          {rt("returning", { seconds: applyDigits(String(Math.max(0, left)), digits) })}
        </p>
      </div>
    </div>
  );
}
