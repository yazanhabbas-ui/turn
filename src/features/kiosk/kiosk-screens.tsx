"use client";

import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, CircleAlert, Hand, Printer, WifiOff } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { onColorLarge } from "@/domain/branding/contrast";
import { applyDigits } from "@/domain/i18n/digits";
import { groupDigits, pressKey, type KeypadKey } from "@/domain/kiosk/keypad";
import { dirOf, pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { T } from "../display/text";
import { waitLine } from "../queue/wait-text";
import { Keypad } from "./keypad";
import type { KioskContext, KioskField, KioskReason, KioskTicket } from "./use-kiosk";

const BIG_BUTTON = "min-h-[4.5rem] rounded-2xl px-8 text-2xl font-bold transition active:scale-[0.98] disabled:opacity-50";

/**
 * The organization's look on the kiosk: its logo on a white plate (so any logo reads), a band in the brand colour with
 * the brand accent as a soft glow, and text that is white or near-black depending on how pale the colour is.
 */
export function brandOf(ctx: Pick<KioskContext, "branding">) {
  const primary = ctx.branding.primaryColor || "#0f766e";
  const accent = ctx.branding.accentColor || "#b45309";
  const on = onColorLarge(primary);
  const pale = on !== "#ffffff";
  const base = pale
    ? `linear-gradient(135deg, color-mix(in srgb, ${primary} 78%, #fff), ${primary})`
    : `linear-gradient(135deg, ${primary}, color-mix(in srgb, ${primary} 66%, #000))`;
  const hero = `radial-gradient(circle at 92% 8%, color-mix(in srgb, ${accent} 55%, transparent) 0, transparent 42%), ${base}`;
  return { primary, accent, on, hero, actionStyle: { backgroundColor: primary, color: on } };
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
  const b = brandOf(ctx);
  if (languages.length < 2) return null;
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
            className="min-h-[3.5rem] min-w-[7rem] rounded-full border-2 px-6 text-xl font-semibold transition active:scale-95"
            style={
              active
                ? { backgroundColor: b.on, color: b.on === "#ffffff" ? b.primary : "#ffffff", borderColor: b.on }
                : { color: b.on, borderColor: `${b.on}66` }
            }
          >
            {l === "ar" ? "العربية" : "English"}
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
      <div className="max-w-2xl space-y-6">
        {ctx && b && (
          <div className="mb-10 inline-block rounded-3xl p-5" style={{ background: b.hero, color: b.on }}>
            <LogoPlate ctx={ctx} lang={lang} />
          </div>
        )}
        {icon}
        <h1 className="text-dsp-strong text-4xl font-bold">{title}</h1>
        {body && <p className="text-dsp-muted text-2xl">{body}</p>}
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
  const welcome = pickText(ctx.options.welcomeText, lang, "");
  const b = brandOf(ctx);
  const Chevron = dirOf(lang) === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <div className="bg-dsp-bg text-dsp-text flex min-h-dvh flex-col">
      <header className="rounded-b-[3rem] px-8 pt-8 pb-20 shadow-xl" style={{ background: b.hero, color: b.on }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          <div className="flex items-center gap-6">
            <LogoPlate ctx={ctx} lang={lang} />
            <span className="rounded-full px-5 py-2 text-2xl font-semibold" style={{ backgroundColor: `${b.on}1f` }}>
              {pickText(ctx.branch.name, lang)}
            </span>
            <div className="ms-auto">
              <LanguageButtons ctx={ctx} lang={lang} languages={languages} t={t} onLang={onLang} />
            </div>
          </div>
          <div className="space-y-3 text-center">
            <h1 className="text-6xl leading-tight font-extrabold tracking-tight">{welcome || t("chooseService")}</h1>
            {welcome && <p className="text-3xl opacity-90">{t("chooseService")}</p>}
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto -mt-10 w-full max-w-6xl flex-1 px-8 pb-10">
        <div className="grid content-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ctx.reasons.map((r) => {
            const staff = r.state === "ask_staff";
            return (
              <button
                key={r.id}
                type="button"
                disabled={staff}
                onClick={() => onPick(r)}
                className={cn(
                  "bg-dsp-surface border-dsp-line text-dsp-strong flex min-h-[9rem] items-center gap-5 rounded-3xl border-2 p-6 text-start shadow-lg transition active:scale-[0.97]",
                  staff ? "[&>*]:opacity-55" : "hover:border-dsp-accent",
                )}
              >
                <span
                  className="grid size-24 shrink-0 place-items-center rounded-2xl text-white shadow-md"
                  style={{ backgroundColor: r.color }}
                >
                  <EntityIcon name={r.icon} className="size-12" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-3xl leading-tight font-bold">{pickText(r.name, lang)}</span>
                  {staff && <span className="text-dsp-muted mt-2 block text-xl">{t("askStaff")}</span>}
                </span>
                {!staff && <Chevron className="text-dsp-muted size-10 shrink-0" aria-hidden />}
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
      <header className="rounded-b-[2.5rem] px-8 py-6 shadow-xl" style={{ background: b.hero, color: b.on }}>
        <div className="mx-auto flex max-w-6xl items-center gap-5">
          <button
            type="button"
            onClick={onBack}
            className={cn(BIG_BUTTON, "flex items-center gap-3 border-2")}
            style={{ borderColor: `${b.on}88`, color: b.on }}
          >
            <BackIcon className="size-8" aria-hidden />
            {t("back")}
          </button>
          <span className="grid size-16 place-items-center rounded-2xl bg-white/95 shadow-md" style={{ color: reason.color }}>
            <EntityIcon name={reason.icon} className="size-9" />
          </span>
          <h1 className="text-4xl font-extrabold">{pickText(reason.name, lang)}</h1>
          <div className="ms-auto hidden sm:block">
            <LogoPlate ctx={ctx} lang={lang} size="md" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-8">
        <div className={cn("grid flex-1 gap-8", hasPhone && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
          <div className="space-y-5">
            {reason.intakeFields.map((f) => {
              const isPhone = f.key === "phone";
              return (
                <div key={f.key} className="space-y-2">
                  <label htmlFor={`k-${f.key}`} className="text-dsp-strong text-2xl font-semibold">
                    {fieldLabel(f, lang, t)}
                    {f.required ? (
                      <span className="text-dsp-hot"> *</span>
                    ) : (
                      <span className="text-dsp-muted text-lg"> ({t("optional")})</span>
                    )}
                  </label>
                  {isPhone ? (
                    <button
                      type="button"
                      id={`k-${f.key}`}
                      dir="ltr"
                      onClick={() => setActive("phone")}
                      className={cn(
                        "tabular bg-dsp-surface text-dsp-strong flex min-h-[5.5rem] w-full items-center justify-center rounded-2xl border-2 px-6 text-5xl tracking-widest",
                        active === "phone" ? "border-dsp-accent ring-dsp-ring ring-4" : "border-dsp-line",
                      )}
                    >
                      {values.phone ? (
                        applyDigits(groupDigits(values.phone), digits)
                      ) : (
                        <span className="text-dsp-subtle">{applyDigits("09xx xxx xxx", digits)}</span>
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
                      className="bg-dsp-surface text-dsp-strong border-dsp-line focus:border-dsp-accent focus:ring-dsp-ring min-h-[5rem] w-full rounded-2xl border-2 px-6 text-3xl outline-none focus:ring-4"
                    />
                  )}
                </div>
              );
            })}
            {needsConsent && (
              <label className="bg-dsp-surface border-dsp-line flex items-start gap-4 rounded-2xl border p-5 text-xl">
                <input
                  type="checkbox"
                  className="mt-1 size-9 shrink-0"
                  style={{ accentColor: b.primary }}
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>{pickText(ctx.privacy.consentText, lang)}</span>
              </label>
            )}
            {error && (
              <p role="alert" className="text-dsp-hot flex items-center gap-3 text-2xl font-semibold">
                <CircleAlert className="size-8 shrink-0" aria-hidden />
                {error}
              </p>
            )}
          </div>
          {hasPhone && (
            <div className="self-start">
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
          className={cn(BIG_BUTTON, "min-h-[5.5rem] w-full text-3xl shadow-xl")}
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
  return (
    <div className="bg-dsp-bg text-dsp-text grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-3xl space-y-5 text-center">
        {result.duplicate && (
          <p className="bg-dsp-surface border-dsp-line mx-auto w-fit rounded-full border px-8 py-3 text-2xl">{t("duplicate")}</p>
        )}
        <div className="bg-dsp-surface border-dsp-line overflow-hidden rounded-[2rem] border shadow-2xl">
          <div className="flex items-center justify-between gap-4 px-8 py-5" style={{ background: b.hero, color: b.on }}>
            <LogoPlate ctx={ctx} lang={lang} size="md" />
            <span className="text-xl font-medium">{pickText(ctx.branch.name, lang)}</span>
          </div>
          <div className="space-y-6 px-8 pt-8 pb-6">
            <p className="text-dsp-soft text-3xl font-semibold">{reason ? pickText(reason.name, lang) : ""}</p>
            <div>
              <p className="text-dsp-muted text-2xl">{t("yourNumber")}</p>
              <p
                className="text-dsp-strong tabular mx-auto mt-2 w-fit rounded-[2rem] border-4 px-10 py-4 text-[8.5rem] leading-none font-extrabold tracking-tight"
                style={{ borderColor: b.primary, backgroundColor: `color-mix(in srgb, ${b.primary} 14%, transparent)` }}
                dir="ltr"
              >
                {applyDigits(result.ticket.displayNumber, digits)}
              </p>
            </div>
            <p className="text-3xl">
              {result.ahead > 0 ? t("ahead", { count: applyDigits(String(result.ahead), digits) }) : t("youAreNext")}
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
            {wait?.disclaimer && <p className="text-dsp-muted -mt-3 text-lg">{wait.disclaimer}</p>}
          </div>
          {qr && (
            <>
              {/* The perforated edge of a ticket. */}
              <div className="relative">
                <span className="bg-dsp-bg absolute -start-4 -top-4 size-8 rounded-full" aria-hidden />
                <span className="bg-dsp-bg absolute -end-4 -top-4 size-8 rounded-full" aria-hidden />
                <div className="border-dsp-line mx-8 border-t-4 border-dashed" />
              </div>
              <div className="flex items-center justify-center gap-6 px-8 py-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="" className="size-44 rounded-xl bg-white p-2 shadow-md" />
                <p className="text-dsp-soft max-w-xs text-start text-2xl">{t("scanQr")}</p>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {ctx.options.printTicket && (
            <button
              type="button"
              onClick={onPrint}
              className={cn(BIG_BUTTON, "bg-dsp-surface border-dsp-line text-dsp-strong flex items-center gap-3 border-2")}
            >
              <Printer className="size-8" aria-hidden />
              {t("print")}
            </button>
          )}
          <button type="button" onClick={onDone} className={cn(BIG_BUTTON, "shadow-xl")} style={b.actionStyle}>
            {t("done")}
          </button>
        </div>
        <p className="text-dsp-muted text-xl" aria-live="off">
          {t("returning", { seconds: applyDigits(String(Math.max(0, left)), digits) })}
        </p>
      </div>
    </div>
  );
}
