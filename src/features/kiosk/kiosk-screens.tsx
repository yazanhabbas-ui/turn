"use client";

import { ArrowLeft, ArrowRight, CircleAlert, Hand, Printer, WifiOff } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { applyDigits } from "@/domain/i18n/digits";
import { groupDigits, pressKey, type KeypadKey } from "@/domain/kiosk/keypad";
import { dirOf, pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { T } from "../display/text";
import { waitLine } from "../queue/wait-text";
import { Keypad } from "./keypad";
import type { KioskContext, KioskField, KioskReason, KioskTicket } from "./use-kiosk";

const BIG_BUTTON = "min-h-[4.5rem] rounded-2xl px-8 text-2xl font-bold transition active:scale-[0.98] disabled:opacity-50";

export function Message({
  icon,
  title,
  body,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center p-8 text-center">
      <div className="max-w-2xl space-y-6">
        {icon}
        <h1 className="text-4xl font-bold">{title}</h1>
        {body && <p className="text-muted-foreground text-2xl">{body}</p>}
        {children}
      </div>
    </div>
  );
}

export function Unavailable({ t }: { t: T }) {
  return (
    <Message
      icon={<Hand className="text-muted-foreground mx-auto size-20" aria-hidden />}
      title={t("unavailableTitle")}
      body={t("unavailableBody")}
    />
  );
}

export function Offline({ t, onRetry }: { t: T; onRetry: () => void }) {
  return (
    <Message
      icon={<WifiOff className="text-muted-foreground mx-auto size-20" aria-hidden />}
      title={t("offlineTitle")}
      body={t("offlineBody")}
    >
      <button type="button" onClick={onRetry} className={cn(BIG_BUTTON, "bg-brand text-white")}>
        {t("retry")}
      </button>
    </Message>
  );
}

/** Welcome, language and the reason buttons. Reasons that need staff are shown but cannot be tapped. */
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
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 p-8">
      <header className="flex items-center gap-6">
        {ctx.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ctx.theme === "light" ? ctx.branding.logoUrl : (ctx.branding.logoDarkUrl ?? ctx.branding.logoUrl)}
            alt=""
            className="h-16 w-auto"
          />
        ) : (
          <span className="text-3xl font-bold">{pickText(ctx.branding.companyName, lang)}</span>
        )}
        <span className="text-muted-foreground text-xl">{pickText(ctx.branch.name, lang)}</span>
        {languages.length > 1 && (
          <div className="ms-auto flex gap-2" role="group" aria-label={t("language")}>
            {languages.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLang(l)}
                aria-pressed={l === lang}
                lang={l}
                className={cn(
                  "min-h-[3.5rem] min-w-[7rem] rounded-full border-2 px-6 text-xl font-semibold",
                  l === lang ? "border-brand bg-brand text-white" : "bg-card",
                )}
              >
                {l === "ar" ? "العربية" : "English"}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="space-y-2 text-center">
        <h1 className="text-5xl leading-tight font-bold">{welcome || t("chooseService")}</h1>
        {welcome && <p className="text-muted-foreground text-2xl">{t("chooseService")}</p>}
      </div>
      <div className="grid flex-1 content-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {ctx.reasons.map((r) => {
          const staff = r.state === "ask_staff";
          return (
            <button
              key={r.id}
              type="button"
              disabled={staff}
              onClick={() => onPick(r)}
              className={cn(
                "bg-card flex min-h-[8.5rem] items-center gap-5 rounded-3xl border-2 p-6 text-start shadow-sm transition active:scale-[0.98]",
                staff ? "opacity-60" : "hover:border-brand/60",
              )}
            >
              <span
                className="grid size-20 shrink-0 place-items-center rounded-2xl text-white"
                style={{ backgroundColor: r.color }}
              >
                <EntityIcon name={r.icon} className="size-10" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-3xl leading-tight font-bold">{pickText(r.name, lang)}</span>
                {staff && <span className="text-muted-foreground mt-2 block text-xl">{t("askStaff")}</span>}
              </span>
            </button>
          );
        })}
      </div>
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
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-8">
      <header className="flex items-center gap-5">
        <button type="button" onClick={onBack} className={cn(BIG_BUTTON, "bg-card flex items-center gap-3 border-2")}>
          <BackIcon className="size-8" aria-hidden />
          {t("back")}
        </button>
        <span className="grid size-16 place-items-center rounded-2xl text-white" style={{ backgroundColor: reason.color }}>
          <EntityIcon name={reason.icon} className="size-8" />
        </span>
        <h1 className="text-4xl font-bold">{pickText(reason.name, lang)}</h1>
      </header>

      <div className={cn("grid flex-1 gap-8", hasPhone && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="space-y-5">
          {reason.intakeFields.map((f) => {
            const isPhone = f.key === "phone";
            return (
              <div key={f.key} className="space-y-2">
                <label htmlFor={`k-${f.key}`} className="text-2xl font-semibold">
                  {fieldLabel(f, lang, t)}
                  {f.required ? (
                    <span className="text-destructive"> *</span>
                  ) : (
                    <span className="text-muted-foreground text-lg"> ({t("optional")})</span>
                  )}
                </label>
                {isPhone ? (
                  <button
                    type="button"
                    id={`k-${f.key}`}
                    dir="ltr"
                    onClick={() => setActive("phone")}
                    className={cn(
                      "tabular bg-card flex min-h-[5.5rem] w-full items-center justify-center rounded-2xl border-2 px-6 text-5xl tracking-widest",
                      active === "phone" && "border-brand ring-brand/30 ring-4",
                    )}
                  >
                    {values.phone ? (
                      applyDigits(groupDigits(values.phone), digits)
                    ) : (
                      <span className="text-muted-foreground/60">{applyDigits("09xx xxx xxx", digits)}</span>
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
                    className="bg-card focus:border-brand min-h-[5rem] w-full rounded-2xl border-2 px-6 text-3xl outline-none"
                  />
                )}
              </div>
            );
          })}
          {needsConsent && (
            <label className="bg-muted/50 flex items-start gap-4 rounded-2xl p-5 text-xl">
              <input
                type="checkbox"
                className="accent-brand mt-1 size-9 shrink-0"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{pickText(ctx.privacy.consentText, lang)}</span>
            </label>
          )}
          {error && (
            <p role="alert" className="text-destructive flex items-center gap-3 text-2xl font-semibold">
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
        className={cn(BIG_BUTTON, "bg-brand min-h-[5.5rem] w-full text-3xl text-white")}
      >
        {busy ? t("issuing") : t("getNumber")}
      </button>
    </div>
  );
}

/** The ticket: big number, people ahead, estimated wait, a QR to the status page, and the countdown back to the start. */
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
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-8 p-8 text-center">
      {result.duplicate && <p className="bg-muted rounded-full px-8 py-3 text-2xl">{t("duplicate")}</p>}
      <p className="text-muted-foreground text-3xl">{reason ? pickText(reason.name, lang) : ""}</p>
      <div>
        <p className="text-muted-foreground text-2xl">{t("yourNumber")}</p>
        <p className="text-brand tabular text-[9rem] leading-none font-bold tracking-tight" dir="ltr">
          {applyDigits(result.ticket.displayNumber, digits)}
        </p>
      </div>
      <p className="text-3xl">
        {result.ahead > 0 ? t("ahead", { count: applyDigits(String(result.ahead), digits) }) : t("youAreNext")}
        {wait && (
          <span className="text-muted-foreground">
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
      {wait?.disclaimer && <p className="text-muted-foreground -mt-4 text-lg">{wait.disclaimer}</p>}
      {qr && (
        <div className="flex items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="" className="size-48 rounded-xl bg-white p-2" />
          <p className="text-muted-foreground max-w-xs text-start text-2xl">{t("scanQr")}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-4">
        {ctx.options.printTicket && (
          <button type="button" onClick={onPrint} className={cn(BIG_BUTTON, "bg-card flex items-center gap-3 border-2")}>
            <Printer className="size-8" aria-hidden />
            {t("print")}
          </button>
        )}
        <button type="button" onClick={onDone} className={cn(BIG_BUTTON, "bg-brand text-white")}>
          {t("done")}
        </button>
      </div>
      <p className="text-muted-foreground text-xl" aria-live="off">
        {t("returning", { seconds: applyDigits(String(Math.max(0, left)), digits) })}
      </p>
    </div>
  );
}
