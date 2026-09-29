"use client";

import { Printer, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { EntityIcon } from "@/components/app/entity-icon";
import { Button } from "@/components/ui/button";
import { applyDigits } from "@/domain/i18n/digits";
import { LOCALE_CODES, LOCALES, pickText } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import type { ReceptionContext } from "../queue/types";
import type { IssueResult } from "./issue-panel";

/**
 * Priority and language, chosen BEFORE tapping a reason so that a normal ticket stays one tap. Priority resets
 * to "normal" after every ticket; the language sticks. Each control can be switched off in Admin → Settings → Reception.
 */
export function QuickBar({
  ctx,
  priorityKey,
  onPriority,
  language,
  onLanguage,
}: {
  ctx: ReceptionContext;
  priorityKey: string | null;
  onPriority: (key: string | null) => void;
  language: string;
  onLanguage: (code: string) => void;
}) {
  const t = useTranslations("reception");
  const locale = useLocale();
  const { askPriority, askLanguage } = ctx.reception;
  const priorities = ctx.priorities.filter((p) => p.key !== "normal");
  if (!(askPriority && priorities.length) && !askLanguage) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {askPriority && priorities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("priority")}>
          <span className="text-muted-foreground text-sm">{t("priority")}</span>
          {priorities.map((p) => {
            const on = priorityKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={on}
                onClick={() => onPriority(on ? null : p.key)}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm",
                  on ? "text-white" : "hover:bg-muted",
                )}
                style={on ? { backgroundColor: p.color, borderColor: p.color } : undefined}
              >
                {p.icon && <EntityIcon name={p.icon} className="size-4" />}
                {pickText(p.name, locale)}
              </button>
            );
          })}
        </div>
      )}
      {askLanguage && (
        <div className="flex items-center gap-2" role="radiogroup" aria-label={t("language")}>
          <span className="text-muted-foreground text-sm">{t("language")}</span>
          {LOCALE_CODES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={language === c}
              onClick={() => onLanguage(c)}
              lang={c}
              className={cn(
                "h-10 rounded-lg border px-4 text-sm",
                language === c ? "border-brand bg-brand/10 text-brand font-semibold" : "hover:bg-muted",
              )}
            >
              {LOCALES[c].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const BANNER_MS = 12_000;

/** Non-blocking confirmation of the last ticket: the receptionist can keep tapping the next reason right away. */
export function IssuedBanner({
  result,
  ctx,
  onPrint,
  onDismiss,
}: {
  result: IssueResult | null;
  ctx: ReceptionContext;
  onPrint: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("reception");
  const tq = useTranslations("queue");
  const locale = useLocale();
  useEffect(() => {
    if (!result) return;
    const id = setTimeout(onDismiss, BANNER_MS);
    return () => clearTimeout(id);
  }, [result, onDismiss]);
  if (!result) return null;
  const reason = ctx.reasons.find((r) => r.id === result.ticket.reasonId);

  return (
    <div
      role="status"
      className="bg-brand/10 border-brand/30 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border px-4 py-3"
    >
      <span className="text-brand tabular text-4xl leading-none font-bold">
        {applyDigits(result.ticket.displayNumber, ctx.regional.digitsScreen)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{pickText(reason?.name, locale)}</span>
        <span className="text-muted-foreground text-sm">
          {tq("ahead", { count: result.ahead })}
          {result.ahead > 0 && ` · ${tq("estimated", { min: result.estimatedWaitMinutes })}`}
        </span>
      </span>
      <Button variant="outline" onClick={onPrint}>
        <Printer aria-hidden />
        {t("print")}
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("dismiss")} onClick={onDismiss}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
