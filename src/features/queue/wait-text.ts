import { waitValueText, type WaitDisplayConfig } from "@/domain/distribution/estimate";
import { applyDigits } from "@/domain/i18n/digits";
import { pickText } from "@/i18n/locales";

/** How the estimated wait is worded (setting `waitEstimate`, display part). Sent with the reception context. */
export type WaitDisplay = WaitDisplayConfig;

export type WaitPosition = { ahead: number; estimatedWaitMinutes: number; waitLow?: number; waitHigh?: number };

export type WaitLine = { label: string; value: string; next: boolean; disclaimer: string };

/**
 * The estimated-wait text for a ticket in the ticket's own language, or null when nothing should be shown
 * (turned off, or nobody ahead). One function for the printed ticket, the confirmation and the visitor page.
 */
export function waitLine(
  pos: WaitPosition | null | undefined,
  display: WaitDisplay | undefined,
  lang: string,
  digits: "latn" | "arab" = "latn",
): WaitLine | null {
  if (!pos || !display || !display.showOnTicket || pos.ahead <= 0) return null;
  const e = {
    minutes: pos.estimatedWaitMinutes,
    low: pos.waitLow ?? pos.estimatedWaitMinutes,
    high: pos.waitHigh ?? pos.estimatedWaitMinutes,
  };
  const v = waitValueText(
    e,
    display,
    (t) => pickText(t, lang),
    (n) => applyDigits(String(n), digits),
  );
  return { label: pickText(display.label, lang), value: v.text, next: v.next, disclaimer: pickText(display.disclaimer, lang) };
}
