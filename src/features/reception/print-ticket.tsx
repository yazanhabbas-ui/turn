"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { applyDigits } from "@/domain/i18n/digits";
import { renderTemplate } from "@/domain/templates/render";
import { wifiQrPayload } from "@/domain/wifi/qr";
import { dirOf, pickText } from "@/i18n/locales";
import type { ReceptionContext, Ticket } from "../queue/types";
import { waitLine } from "../queue/wait-text";

export type PrintJob = { ticket: Ticket; ahead: number; estimatedWaitMinutes: number; waitLow?: number; waitHigh?: number };

/** What the QR code on the ticket is for, in the ticket's language (it prints in the visitor's language). */
const QR_CAPTION: Record<string, string> = {
  ar: "امسح الرمز لمتابعة دورك مباشرة",
  en: "Scan to follow your turn live",
};

/** Link printed as a QR code: the visitor's live status page on this server. */
export function statusUrl(ticket: Ticket) {
  return `${window.location.origin}/t/${ticket.publicToken}`;
}

/**
 * The ticket as it prints on an 80 mm thermal printer (ESC/POS printers print browser pages through their
 * driver). Rendered into a print-only container; `@media print` in globals.css hides everything else.
 */
export function PrintTicket({ job, ctx, onDone }: { job: PrintJob | null; ctx: ReceptionContext; onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [wifiQr, setWifiQr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const go = async () => {
      const showQr = ctx.ticketing.showQrOnTicket && ctx.visitorStatus.enabled;
      setQr(showQr ? await QRCode.toDataURL(statusUrl(job.ticket), { margin: 0, width: 220, errorCorrectionLevel: "M" }) : null);
      const wifi = ctx.wifi;
      setWifiQr(
        wifi.enabled && wifi.ssid && wifi.showQr
          ? await QRCode.toDataURL(wifiQrPayload(wifi.ssid, wifi.password), { margin: 0, width: 200, errorCorrectionLevel: "M" })
          : null,
      );
      if (cancelled) return;
      // Let the QR image render before opening the print dialog.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.print();
          onDone();
        }),
      );
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [job, ctx, onDone]);

  if (!mounted || !job) return null;
  const lang = job.ticket.language;
  const digits = ctx.regional.digitsTicket;
  const reason = ctx.reasons.find((r) => r.id === job.ticket.reasonId);
  const number = applyDigits(job.ticket.displayNumber, digits);
  const vars = {
    ticket: number,
    reason: pickText(reason?.name, lang),
    ahead: applyDigits(String(job.ahead), digits),
    wait: applyDigits(String(job.estimatedWaitMinutes), digits),
  };
  // The estimated wait comes from the Waiting time settings (label, range, disclaimer); template lines that carry
  // {wait} are replaced by it so an older template cannot print a second, different figure.
  const wait = waitLine(job, ctx.waitDisplay, lang, digits);
  const lines = (pickText(ctx.print.template, lang) || "{ticket}\n{reason}").split("\n").filter((l) => !l.includes("{wait}"));
  const when = new Intl.DateTimeFormat(lang === "ar" ? `ar-u-nu-${digits}` : "en-GB", {
    timeZone: ctx.branch.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(job.ticket.arrivedAt));

  return createPortal(
    <div id="print-root" dir={dirOf(lang)} lang={lang}>
      <div className="ticket">
        {ctx.print.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ctx.print.logoUrl} alt="" className="ticket-logo" />
        ) : (
          <div className="ticket-company">{pickText(ctx.print.companyName, lang)}</div>
        )}
        {lines.map((line, i) =>
          line.includes("{ticket}") ? (
            <div key={i} className="ticket-number">
              {renderTemplate(line, vars)}
            </div>
          ) : (
            <div key={i} className="ticket-line">
              {renderTemplate(line, vars)}
            </div>
          ),
        )}
        {wait && (
          <div className="ticket-line">
            <div className="ticket-wait">
              {wait.next ? (
                wait.value
              ) : (
                <>
                  {wait.label}: <bdi>{wait.value}</bdi>
                </>
              )}
            </div>
            {wait.disclaimer && <div className="ticket-disclaimer">{wait.disclaimer}</div>}
          </div>
        )}
        {qr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" className="ticket-qr" />
            <div className="ticket-qr-caption">{QR_CAPTION[lang] ?? QR_CAPTION.en}</div>
          </>
        )}
        {ctx.wifi.enabled && ctx.wifi.ssid && (
          <div className="ticket-wifi">
            <div className="ticket-wifi-title">{pickText(ctx.wifi.title, lang)}</div>
            <div>
              {pickText(ctx.wifi.ssidLabel, lang)}: <bdi className="ticket-wifi-value">{ctx.wifi.ssid}</bdi>
            </div>
            {ctx.wifi.password && (
              <div>
                {pickText(ctx.wifi.passwordLabel, lang)}: <bdi className="ticket-wifi-value">{ctx.wifi.password}</bdi>
              </div>
            )}
            {wifiQr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wifiQr} alt="" className="ticket-wifi-qr" />
            )}
          </div>
        )}
        <div className="ticket-footer">{pickText(ctx.print.footer, lang)}</div>
        <div className="ticket-meta">{when}</div>
      </div>
    </div>,
    document.body,
  );
}
