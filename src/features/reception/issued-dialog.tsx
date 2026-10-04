"use client";

import { Printer } from "lucide-react";
import QRCode from "qrcode";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyDigits } from "@/domain/i18n/digits";
import { pickText } from "@/i18n/locales";
import { CallCode } from "../queue/bits";
import type { ReceptionContext } from "../queue/types";
import { waitLine } from "../queue/wait-text";
import type { IssueResult } from "./issue-panel";

/** Big confirmation of the issued number with people ahead and estimated wait. Enter = new ticket. */
export function IssuedDialog({
  result,
  ctx,
  autoPrint,
  onAutoPrint,
  onPrint,
  onClose,
}: {
  result: IssueResult | null;
  ctx: ReceptionContext;
  autoPrint: boolean;
  onAutoPrint: (v: boolean) => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("reception");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const newRef = useRef<HTMLButtonElement>(null);
  // Without a printer the visitor can scan this from the screen to follow the turn on their own phone.
  const [qr, setQr] = useState<string | null>(null);
  const showQr = !!result && ctx.ticketing.showQrOnTicket && ctx.visitorStatus.enabled;
  const token = result?.ticket.publicToken;
  useEffect(() => {
    if (!showQr || !token) return setQr(null);
    let cancelled = false;
    void QRCode.toDataURL(`${window.location.origin}/t/${token}`, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(
      (d) => !cancelled && setQr(d),
    );
    return () => {
      cancelled = true;
    };
  }, [showQr, token]);
  useEffect(() => {
    if (result) setTimeout(() => newRef.current?.focus(), 50);
  }, [result]);
  if (!result) return null;
  const reason = ctx.reasons.find((r) => r.id === result.ticket.reasonId);
  const digits = ctx.regional.digitsScreen;
  const wait = waitLine(result, ctx.waitDisplay, locale, digits);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="text-center sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">{t("issued")}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{pickText(reason?.name, locale)}</p>
        <p className="text-brand tabular text-7xl leading-none font-bold tracking-tight" aria-label={t("yourNumber")}>
          {applyDigits(result.ticket.displayNumber, digits)}
        </p>
        {result.ticket.callCode && (
          <p className="text-lg">
            {t("calledByPhone")} <CallCode code={result.ticket.callCode} className="text-xl" />
          </p>
        )}
        <p className="text-lg">
          {tq("ahead", { count: result.ahead })}
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
        {wait?.disclaimer && <p className="text-muted-foreground -mt-2 text-xs">{wait.disclaimer}</p>}
        {qr && (
          <div className="flex items-center justify-center gap-4 rounded-2xl border p-3 text-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" className="size-32 rounded-lg bg-white p-1" />
            <p className="text-muted-foreground max-w-48 text-sm">{t("scanToTrack")}</p>
          </div>
        )}
        <label className="text-muted-foreground mx-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-brand size-4"
            checked={autoPrint}
            onChange={(e) => onAutoPrint(e.target.checked)}
          />
          {t("autoPrint")}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12 text-base" onClick={onPrint}>
            <Printer aria-hidden />
            {t("print")}
          </Button>
          <Button ref={newRef} className="h-12 text-base" onClick={onClose}>
            {t("newTicket")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
