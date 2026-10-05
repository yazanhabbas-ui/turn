"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dirOf, pickText } from "@/i18n/locales";
import { Pairing } from "../display/pairing";
import { makeT, type Dicts } from "../display/text";
import { makePageT } from "../pagecontent/make-t";
import { PrintTicket, type PrintJob } from "../reception/print-ticket";
import type { ReceptionContext, Ticket } from "../queue/types";
import { Form, Home, KioskShell, Message, Offline, Result, Unavailable } from "./kiosk-screens";
import {
  clearToken,
  issueAtKiosk,
  KioskError,
  newKey,
  readToken,
  saveToken,
  useKioskContext,
  type KioskContext,
  type KioskReason,
  type KioskTicket,
} from "./use-kiosk";

/** A visitor who walks away from a half-filled form: the kiosk goes back to the start after this long without a touch. */
const FORM_IDLE_MS = 60_000;

/** Entry point of the self check-in tablet: pairing first, then the kiosk once a device token exists. */
export function KioskApp({ dicts, defaultLang }: { dicts: Dicts; defaultLang: "ar" | "en" }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(readToken()), []);
  const t = makeT(dicts[defaultLang]);

  if (token === undefined) return <div className="min-h-dvh" />;
  if (!token) {
    return (
      <div dir={dirOf(defaultLang)} lang={defaultLang} className="dark min-h-dvh bg-neutral-950 text-neutral-50">
        <Pairing
          t={t}
          endpoint="/api/v1/kiosk/pair"
          onPaired={(tok) => {
            saveToken(tok);
            setToken(tok);
          }}
        />
      </div>
    );
  }
  return (
    <Kiosk
      token={token}
      dicts={dicts}
      defaultLang={defaultLang}
      onRevoked={() => {
        clearToken();
        setToken(null);
      }}
    />
  );
}

type View =
  | { name: "home" }
  | { name: "form"; reason: KioskReason }
  | { name: "result"; reason: KioskReason | undefined; result: KioskTicket };

function Kiosk({
  token,
  dicts,
  defaultLang,
  onRevoked,
}: {
  token: string;
  dicts: Dicts;
  defaultLang: "ar" | "en";
  onRevoked: () => void;
}) {
  const { ctx, failing, refetch } = useKioskContext(token, onRevoked);
  const languages = useMemo(() => (ctx?.languages?.length ? ctx.languages : [defaultLang]), [ctx?.languages, defaultLang]);
  const [lang, setLang] = useState<string>(defaultLang);
  const [view, setView] = useState<View>({ name: "home" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const key = useRef(newKey());
  const issuing = useRef(false);
  // The administrator's own wording (page content, D66) on top of the message files.
  const t = makePageT(dicts[lang === "en" ? "en" : "ar"], lang, ctx?.pageContent?.texts, {
    branch: ctx ? pickText(ctx.branch.name, lang) : undefined,
  });

  // The configured first language wins until a visitor picks another one.
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current && languages[0]) setLang(languages[0]);
  }, [languages]);

  const home = useCallback(() => {
    setView({ name: "home" });
    setError(null);
    setBusy(false);
    key.current = newKey();
    // Each visitor starts in the kiosk's own first language.
    picked.current = false;
    setLang(languages[0] ?? defaultLang);
  }, [languages, defaultLang]);

  // Walk-away protection on the form.
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    const touch = () => (lastTouch.current = Date.now());
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const id = setInterval(() => {
      if (view.name === "form" && !busy && Date.now() - lastTouch.current > FORM_IDLE_MS) home();
    }, 5000);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      clearInterval(id);
    };
  }, [view.name, busy, home]);

  const message = useCallback(
    (err: unknown): string => {
      if (!(err instanceof KioskError)) return t("genericError");
      switch (err.kind) {
        case "network":
          return t("networkError");
        case "queue_full":
          return t("queueFull");
        case "rate_limited":
          return t("slowDown");
        case "ask_staff":
        case "disabled":
          return t("askStaffError");
        case "invalid_phone":
          return t("invalidPhone");
        case "missing_field":
          return t("missingField");
        default:
          return t("genericError");
      }
    },
    [t],
  );

  const submit = useCallback(
    async (reason: KioskReason, fields: Record<string, string>, consent: boolean) => {
      if (issuing.current) return;
      issuing.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await issueAtKiosk(token, { reasonId: reason.id, language: lang, fields, consent }, key.current);
        key.current = newKey();
        setView({ name: "result", reason, result });
        if (ctx?.options.printTicket) setPrintJob(printJobOf(result));
        void refetch();
      } catch (err) {
        if (err instanceof KioskError && err.kind === "unauthorized") return onRevoked();
        setError(message(err));
        // The same idempotency key stays: a retry after a lost answer must not create a second ticket.
        if (err instanceof KioskError && (err.kind === "queue_full" || err.kind === "ask_staff" || err.kind === "disabled")) {
          key.current = newKey();
        }
      } finally {
        issuing.current = false;
        setBusy(false);
      }
    },
    [token, lang, ctx?.options.printTicket, refetch, onRevoked, message],
  );

  const pick = useCallback(
    (reason: KioskReason) => {
      lastTouch.current = Date.now();
      key.current = newKey();
      setError(null);
      // The fast path: a reason with nothing to type issues on the first tap.
      if (reason.intakeFields.length === 0) {
        setView({ name: "form", reason });
        void submit(reason, {}, false);
      } else setView({ name: "form", reason });
    },
    [submit],
  );

  const printCtx = useMemo(() => (ctx ? printContext(ctx) : null), [ctx]);
  const printDone = useCallback(() => setPrintJob(null), []);
  // The kiosk wears the same themes and brand colours as the waiting-room screens of the branch (dark, light, brand).
  const shell = (children: React.ReactNode) => (
    <KioskShell lang={lang} theme={ctx?.theme} branding={ctx?.branding}>
      {children}
    </KioskShell>
  );

  if (!ctx) {
    return shell(failing ? <Offline t={t} onRetry={() => void refetch()} /> : <Message title={t("loading")} />);
  }
  if (!ctx.enabled || ctx.reasons.length === 0) return shell(<Unavailable t={t} ctx={ctx} lang={lang} />);

  return shell(
    <>
      {view.name === "home" && (
        <Home
          ctx={ctx}
          lang={lang}
          languages={languages}
          t={t}
          onLang={(l) => ((picked.current = true), setLang(l))}
          onPick={pick}
        />
      )}
      {view.name === "form" && (
        <Form
          key={view.reason.id}
          ctx={ctx}
          reason={view.reason}
          lang={lang}
          t={t}
          busy={busy}
          error={error}
          onBack={home}
          onSubmit={(fields, consent) => void submit(view.reason, fields, consent)}
        />
      )}
      {view.name === "result" && (
        <Result
          ctx={ctx}
          result={view.result}
          reason={view.reason}
          lang={lang}
          t={t}
          onDone={home}
          onPrint={() => setPrintJob(printJobOf(view.result))}
        />
      )}
      {failing && view.name === "home" && (
        <p className="bg-dsp-surface text-dsp-muted border-dsp-line fixed inset-x-0 bottom-0 border-t p-3 text-center text-lg">
          {t("offlineBanner")}
        </p>
      )}
      {printCtx && <PrintTicket job={printJob} ctx={printCtx} onDone={printDone} />}
    </>,
  );
}

function printJobOf(r: KioskTicket): PrintJob {
  return {
    ticket: r.ticket as unknown as Ticket,
    ahead: r.ahead,
    estimatedWaitMinutes: r.estimatedWaitMinutes,
    waitLow: r.waitLow,
    waitHigh: r.waitHigh,
  };
}

/** The printed ticket reads the same context shape reception uses; the kiosk fills in the parts it needs. */
function printContext(ctx: KioskContext): ReceptionContext {
  return {
    branch: ctx.branch,
    reasons: ctx.reasons,
    ticketing: { showQrOnTicket: ctx.ticketing.showQrOnTicket },
    visitorStatus: { enabled: ctx.options.showQr },
    wifi: ctx.wifi,
    regional: ctx.regional,
    waitDisplay: ctx.waitDisplay,
    print: {
      template: ctx.printTemplate,
      footer: ctx.branding.ticketFooter,
      companyName: ctx.branding.companyName,
      logoUrl: ctx.branding.logoUrl,
      logoDarkUrl: ctx.branding.logoDarkUrl,
    },
  } as unknown as ReceptionContext;
}
