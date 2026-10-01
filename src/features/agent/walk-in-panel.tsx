"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer, QrCode, UserRoundPlus } from "lucide-react";
import QRCode from "qrcode";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyDigits } from "@/domain/i18n/digits";
import { pickText } from "@/i18n/locales";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentWorkspace, ReceptionContext } from "../queue/types";
import { waitLine } from "../queue/wait-text";
import { IssuePanel, ReasonPicker, type IssueResult } from "../reception/issue-panel";
import { PrintTicket, statusUrl, type PrintJob } from "../reception/print-ticket";
import { QuickBar } from "../reception/quick-bar";

const WALK_IN = "/api/v1/queue/agent/walk-in";
const NO_PRINTER_KEY = "dor.agent.noPrinter";

type Mode = "serve" | "queue";

/**
 * "New walk-in visitor" (D61): the agent issues a ticket from their own screen when the branch has no receptionist
 * (or always, per setting). Same reasons, intake fields, consent and numbering as reception. "Serve now" takes the
 * visitor at once; "Add to queue" is a normal ticket.
 */
export function WalkInButton({
  ws,
  open,
  onOpenChange,
  onChanged,
}: {
  ws: AgentWorkspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("walkIn");
  if (!ws.walkIn.allowed) return null;
  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => onOpenChange(true)}>
        <UserRoundPlus aria-hidden />
        {t("button")}
      </Button>
      {open && <WalkInDialog ws={ws} onClose={() => onOpenChange(false)} onChanged={onChanged} />}
    </>
  );
}

function WalkInDialog({ ws, onClose, onChanged }: { ws: AgentWorkspace; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("walkIn");
  const locale = useLocale();
  const ctx = useQuery<ReceptionContext>({ queryKey: ["walk-in-ctx"], queryFn: () => api(WALK_IN), refetchOnWindowFocus: false });
  const atCapacity = ws.active.length >= ws.profile.maxConcurrent;
  const [mode, setMode] = useState<Mode>("queue");
  const [selected, setSelected] = useState<string | null>(null);
  const [priorityKey, setPriorityKey] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [result, setResult] = useState<(IssueResult & { served: boolean }) | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [noPrinter, setNoPrinter] = useState(false);
  useEffect(() => {
    try {
      setNoPrinter(localStorage.getItem(NO_PRINTER_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  const serves = useMemo(() => new Set(ws.reasons.filter((r) => r.serves).map((r) => r.id)), [ws.reasons]);
  // "Serve now" only offers the reasons this agent serves; "Add to queue" offers every reason of the branch.
  const view = useMemo(() => {
    if (!ctx.data) return null;
    return mode === "serve" ? { ...ctx.data, reasons: ctx.data.reasons.filter((r) => serves.has(r.id)) } : ctx.data;
  }, [ctx.data, mode, serves]);
  const reason = view?.reasons.find((r) => r.id === selected) ?? null;
  const visitorLanguage =
    language ??
    (ctx.data?.reception.defaultLanguage === "en" ? "en" : ctx.data?.reception.defaultLanguage === "ar" ? "ar" : locale);

  const submit = async (
    c: ReceptionContext,
    o: { priorityKey: string | null; language: string; fields: Record<string, string>; consent: boolean; idempotencyKey: string },
  ) => {
    const res = await api<IssueResult>("/api/v1/queue/agent/issue", {
      body: {
        reasonId: selected,
        priorityKey: o.priorityKey,
        language: o.language,
        fields: o.fields,
        consent: o.consent,
        serveNow: mode === "serve",
      },
      idempotencyKey: o.idempotencyKey,
    });
    setResult({ ...res, served: mode === "serve" });
    setSelected(null);
    setPriorityKey(null);
    onChanged();
    if (c.reception.autoPrint && !noPrinter) setPrintJob(res);
    return res;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {ctx.isLoading && <LoadingRows rows={3} />}
        {ctx.isError && <ErrorState onRetry={() => void ctx.refetch()} />}
        {ctx.data && view && result && (
          <WalkInResult
            ctx={ctx.data}
            result={result}
            noPrinter={noPrinter}
            onNoPrinter={(v) => {
              setNoPrinter(v);
              try {
                localStorage.setItem(NO_PRINTER_KEY, v ? "1" : "0");
              } catch {
                /* ignore */
              }
            }}
            onPrint={() => setPrintJob(result)}
            onAnother={() => setResult(null)}
            onClose={onClose}
          />
        )}
        {ctx.data && view && !result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("mode")}>
              {(["queue", "serve"] as const).map((m) => {
                const disabled = m === "serve" && atCapacity;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    disabled={disabled}
                    onClick={() => {
                      setMode(m);
                      setSelected(null);
                    }}
                    className={cn(
                      "rounded-2xl border-2 p-3 text-start disabled:opacity-50",
                      mode === m ? "border-brand bg-brand/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="block font-semibold">{t(m === "serve" ? "serveNow" : "addToQueue")}</span>
                    <span className="text-muted-foreground text-xs">
                      {disabled ? t("atCapacity") : t(m === "serve" ? "serveNowHint" : "addToQueueHint")}
                    </span>
                  </button>
                );
              })}
            </div>
            <QuickBar
              ctx={view}
              priorityKey={priorityKey}
              onPriority={setPriorityKey}
              language={visitorLanguage}
              onLanguage={setLanguage}
            />
            {view.reasons.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noReasons")}</p>
            ) : (
              <ReasonPicker ctx={view} selected={selected} onSelect={(id) => setSelected((cur) => (cur === id ? null : id))} />
            )}
            {reason && (
              <IssuePanel
                ctx={view}
                reason={reason}
                priorityKey={priorityKey}
                language={visitorLanguage}
                hideAssign
                submit={(o) => submit(view, o)}
                onIssued={() => undefined}
                onClear={() => setSelected(null)}
              />
            )}
          </div>
        )}
        {ctx.data && <PrintTicket job={printJob} ctx={ctx.data} onDone={() => setPrintJob(null)} />}
      </DialogContent>
    </Dialog>
  );
}

/** The ticket on screen: number, wait and a QR the visitor can scan, in case this computer has no printer. */
function WalkInResult({
  ctx,
  result,
  noPrinter,
  onNoPrinter,
  onPrint,
  onAnother,
  onClose,
}: {
  ctx: ReceptionContext;
  result: IssueResult & { served: boolean };
  noPrinter: boolean;
  onNoPrinter: (v: boolean) => void;
  onPrint: () => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("walkIn");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const [qr, setQr] = useState<string | null>(null);
  const showQr = ctx.ticketing.showQrOnTicket && ctx.visitorStatus.enabled;
  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    void QRCode.toDataURL(statusUrl(result.ticket), { margin: 1, width: 280, errorCorrectionLevel: "M" }).then(
      (d) => !cancelled && setQr(d),
    );
    return () => {
      cancelled = true;
    };
  }, [showQr, result.ticket]);
  const reason = ctx.reasons.find((r) => r.id === result.ticket.reasonId);
  const digits = ctx.regional.digitsScreen;
  const wait = waitLine(result, ctx.waitDisplay, locale, digits);

  return (
    <div className="space-y-4 text-center">
      <p className="text-muted-foreground text-sm">{pickText(reason?.name, locale)}</p>
      <p className="text-brand tabular text-7xl leading-none font-bold" dir="ltr">
        {applyDigits(result.ticket.displayNumber, digits)}
      </p>
      {result.served ? (
        <p className="text-lg font-medium">{t("servedNow")}</p>
      ) : (
        <p className="text-lg">
          {tq("ahead", { count: result.ahead })}
          {wait && (
            <span className="text-muted-foreground">
              {" · "}
              {wait.next ? wait.value : `${wait.label}: ${wait.value}`}
            </span>
          )}
        </p>
      )}
      {qr && !result.served && (
        <div className="mx-auto flex w-fit items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="" className="size-36 rounded-lg bg-white p-1.5" />
          <p className="text-muted-foreground flex max-w-48 items-start gap-2 text-start text-sm">
            <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("scanQr")}
          </p>
        </div>
      )}
      <label className="text-muted-foreground mx-auto flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-brand size-4"
          checked={noPrinter}
          onChange={(e) => onNoPrinter(e.target.checked)}
        />
        {t("noPrinter")}
      </label>
      <div className="grid grid-cols-3 gap-3">
        <Button variant="outline" className="h-12" onClick={onPrint}>
          <Printer aria-hidden />
          {t("print")}
        </Button>
        <Button variant="outline" className="h-12" onClick={onAnother}>
          {t("another")}
        </Button>
        <Button className="h-12" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}
