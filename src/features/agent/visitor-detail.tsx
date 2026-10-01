"use client";

import { Phone } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { pickText } from "@/i18n/locales";
import type { AgentWorkspace, Ticket, VisitHistoryItem } from "../queue/types";

type ReasonInfo = AgentWorkspace["reasons"][number] | undefined;

/** Contact details, intake answers and notes of a visitor (shared by the desk panel and the hall panel). */
export function VisitorInfo({ ticket, reason }: { ticket: Ticket; reason: ReasonInfo }) {
  const t = useTranslations("agent");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const label = (key: string) => {
    if (tr.has(`intakeFields.${key}`)) return tr(`intakeFields.${key}`);
    return pickText(reason?.intakeFields.find((f) => f.key === key)?.label, locale, key);
  };
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-sm font-medium">{t("visitorInfo")}</h3>
      {ticket.visitor?.name ||
      ticket.visitor?.phone ||
      ticket.visitor?.company ||
      Object.keys(ticket.intake).length ||
      ticket.notes ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {ticket.visitor?.name && (
            <div>
              <dt className="text-muted-foreground text-xs">{label("name")}</dt>
              <dd className="text-base font-medium">{ticket.visitor.name}</dd>
            </div>
          )}
          {ticket.visitor?.phone && (
            <div>
              <dt className="text-muted-foreground text-xs">{label("phone")}</dt>
              <dd>
                <a href={`tel:${ticket.visitor.phone}`} className="text-brand inline-flex items-center gap-1 text-base" dir="ltr">
                  <Phone className="size-4" aria-hidden />
                  {ticket.visitor.phone}
                </a>
              </dd>
            </div>
          )}
          {ticket.visitor?.company && (
            <div>
              <dt className="text-muted-foreground text-xs">{label("company")}</dt>
              <dd>{ticket.visitor.company}</dd>
            </div>
          )}
          {Object.entries(ticket.intake).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground text-xs">{label(k)}</dt>
              <dd dir="auto">{v}</dd>
            </div>
          ))}
          {ticket.notes && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs">{label("notes")}</dt>
              <dd className="whitespace-pre-wrap">{ticket.notes}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noVisitorInfo")}</p>
      )}
    </div>
  );
}

export function VisitHistory({
  visitor,
  history,
  reasons,
}: {
  visitor: NonNullable<Ticket["visitor"]>;
  history: VisitHistoryItem[];
  reasons: AgentWorkspace["reasons"];
}) {
  const t = useTranslations("agent");
  const tq = useTranslations("queue");
  const tts = useTranslations("ticketStatus");
  const locale = useLocale();
  const format = useFormatter();
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-sm font-medium">{t("visitHistory")}</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{t("visitNumber", { n: visitor.visitCount + 1 })}</span>
        {visitor.returning ? (
          <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-xs font-medium">{tq("returning")}</span>
        ) : (
          <span className="bg-muted rounded-full px-2 py-0.5 text-xs">{t("visitFirst")}</span>
        )}
        {visitor.lastVisitAt && (
          <span className="text-muted-foreground">
            {t("visitLast", { date: format.dateTime(new Date(visitor.lastVisitAt), { dateStyle: "medium" }) })}
          </span>
        )}
      </div>
      {history.length > 0 && (
        <ul className="mt-2 divide-y rounded-xl border text-sm">
          {history.map((v, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="tabular font-semibold" dir="ltr">
                {v.displayNumber}
              </span>
              <span className="text-muted-foreground text-xs">
                {format.dateTime(new Date(v.arrivedAt), { dateStyle: "medium", timeStyle: "short" })}
              </span>
              <span className="flex-1 truncate">{pickText(reasons.find((r) => r.id === v.reasonId)?.name, locale)}</span>
              <span className="text-muted-foreground text-xs">
                {v.outcome && t.has(`outcomes.${v.outcome}`)
                  ? t(`outcomes.${v.outcome}`)
                  : tts.has(v.status)
                    ? tts(v.status)
                    : v.status}
                {v.agentName && <> · {t("visitServedBy", { name: pickText(v.agentName, locale) })}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
