"use client";

import { Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useErrorMessage } from "@/components/admin/use-api";
import { EntityIcon } from "@/components/app/entity-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { looseNameMatch } from "@/domain/i18n/arabic-normalize";
import { pickText } from "@/i18n/locales";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ReceptionContext, ReceptionReason, Ticket } from "../queue/types";

const BUILTIN_TYPES: Record<string, "text" | "tel" | "email"> = { phone: "tel", email: "email" };

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Large touch buttons; featured reasons first; searchable (Arabic-normalized); keyboard shortcuts. */
export function ReasonPicker({
  ctx,
  selected,
  onSelect,
}: {
  ctx: ReceptionContext;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("reception");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const reasons = useMemo(() => {
    const list = [...ctx.reasons].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));
    if (!q.trim()) return list;
    return list.filter(
      (r) => Object.values(r.name).some((n) => looseNameMatch(n, q)) || r.prefix.toLowerCase() === q.trim().toLowerCase(),
    );
  }, [ctx.reasons, q]);

  return (
    <section aria-label={t("chooseReason")} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("chooseReason")}</h2>
        <div className="relative w-56">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-2.5 size-4" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-9 ps-8"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {reasons.map((r) => {
          const active = selected === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={active}
              className={cn(
                "bg-card relative flex min-h-24 items-center gap-3 rounded-2xl border-2 p-4 text-start shadow-sm transition active:scale-[0.99]",
                active ? "border-brand ring-brand/30 ring-4" : "hover:border-brand/40 border-transparent",
              )}
            >
              <span
                className="grid size-12 shrink-0 place-items-center rounded-xl text-white"
                style={{ backgroundColor: r.color }}
              >
                <EntityIcon name={r.icon} className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-tight font-semibold">{pickText(r.name, locale)}</span>
                <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="text-foreground font-bold">{r.prefix}</span>
                  <span>{tq("waitingN", { count: r.waiting })}</span>
                </span>
              </span>
              {r.shortcutKey && (
                <kbd
                  className="bg-muted text-muted-foreground absolute end-2 top-2 rounded px-1.5 text-xs"
                  aria-label={t("shortcut", { key: r.shortcutKey })}
                >
                  {r.shortcutKey}
                </kbd>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export type IssueResult = { ticket: Ticket; ahead: number; estimatedWaitMinutes: number };

/** The single place that turns a reception choice into a ticket (used by one-tap issuing and by the form). */
export function issueRequest(
  ctx: ReceptionContext,
  reason: ReceptionReason,
  opts: {
    priorityKey: string | null;
    language: string;
    fields?: Record<string, string>;
    consent?: boolean;
    assignToAgentId?: string | null;
    appointmentId?: string | null;
    idempotencyKey: string;
  },
) {
  const priority = opts.priorityKey ?? reason.defaultPriorityKey ?? null;
  return api<IssueResult & { duplicate: boolean }>("/api/v1/queue/tickets", {
    body: {
      branchId: ctx.branch.id,
      reasonId: reason.id,
      priorityKey: priority === "normal" ? null : priority,
      language: opts.language,
      fields: opts.fields ?? {},
      consent: opts.consent ?? false,
      assignToAgentId: opts.assignToAgentId ?? null,
      appointmentId: opts.appointmentId ?? null,
      source: opts.appointmentId ? "appointment" : "reception",
    },
    idempotencyKey: opts.idempotencyKey,
  });
}

/** Intake fields, priority, language, consent and the big Issue button for the selected reason. */
export function IssuePanel({
  ctx,
  reason,
  appointmentId,
  priorityKey,
  language,
  onIssued,
  onClear,
}: {
  ctx: ReceptionContext;
  reason: ReceptionReason;
  appointmentId?: string | null;
  /** Chosen in the bar above the reasons; null = the reason's default. */
  priorityKey: string | null;
  language: string;
  onIssued: (r: IssueResult) => void;
  onClear: () => void;
}) {
  const t = useTranslations("reception");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const message = useErrorMessage();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [assignTo, setAssignTo] = useState("");
  const [consent, setConsent] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const issueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFields({});
    setAssignTo("");
    setConsent(false);
    setError(null);
    setShowOptional(false);
    key.current = newKey();
    // Straight into the first thing to type; with nothing to type, onto the Issue button.
    const first = reason.intakeFields.find((f) => f.required);
    if (first) document.getElementById(`f-${first.key}`)?.focus();
    else issueRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason.id]);

  const required = reason.intakeFields.filter((f) => f.required);
  const optional = reason.intakeFields.filter((f) => !f.required);
  const hasPersonalData = Object.values(fields).some((v) => v.trim());
  const needsConsent = ctx.privacy.requireConsent && hasPersonalData;
  const manual = ctx.modes[reason.id] === "manual";
  const agents = ctx.agents.filter((a) => a.reasons.includes(reason.id));
  const label = (key: string, custom?: Record<string, string>) =>
    tr.has(`intakeFields.${key}`) ? tr(`intakeFields.${key}`) : pickText(custom, locale, key);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await issueRequest(ctx, reason, {
        priorityKey,
        language,
        fields,
        consent,
        assignToAgentId: assignTo || null,
        appointmentId,
        idempotencyKey: key.current,
      });
      key.current = newKey();
      onIssued(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const reasonCode = err.details?.reason as string | undefined;
        const field = err.details?.field as string | undefined;
        if (reasonCode && t.has(`errors.${reasonCode}`)) {
          setError(t(`errors.${reasonCode}`, { field: field ? label(field) : "" }));
          if (reasonCode === "missing_field" || reasonCode === "invalid_field") setShowOptional(true);
        } else setError(message(err));
      } else setError(message(err));
      // Keep the same idempotency key: a retry after a network error must not create a second ticket.
    } finally {
      setBusy(false);
    }
  }

  const field = (f: (typeof reason.intakeFields)[number]) => {
    const id = `f-${f.key}`;
    const common = {
      id,
      value: fields[f.key] ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setFields((v) => ({ ...v, [f.key]: e.target.value })),
      required: f.required,
    };
    return (
      <div key={f.key} className={cn("space-y-1.5", f.key === "notes" && "sm:col-span-2")}>
        <Label htmlFor={id}>
          {label(f.key, f.label)}
          {f.required && <span className="text-destructive"> *</span>}
        </Label>
        {f.key === "notes" ? (
          <Textarea {...common} rows={2} />
        ) : (
          <Input
            {...common}
            type={BUILTIN_TYPES[f.key] ?? (f.type === "phone" ? "tel" : f.type === "email" ? "email" : "text")}
            inputMode={
              f.key === "phone" || f.key === "national_id_last4" || f.type === "number" || f.type === "phone"
                ? "numeric"
                : undefined
            }
            dir={f.key === "phone" || f.key === "email" || f.key === "national_id_last4" ? "ltr" : undefined}
            maxLength={f.key === "national_id_last4" ? 4 : 200}
            className="h-11"
          />
        )}
      </div>
    );
  };

  return (
    <form
      className="bg-card space-y-4 rounded-2xl border p-4 shadow-sm md:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void issue();
      }}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl text-white" style={{ backgroundColor: reason.color }}>
          <EntityIcon name={reason.icon} className="size-5" />
        </span>
        <h2 className="flex-1 text-lg font-semibold">{pickText(reason.name, locale)}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label={t("newTicket")} onClick={onClear}>
          <X aria-hidden />
        </Button>
      </div>

      {required.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{required.map(field)}</div>}
      {optional.length > 0 &&
        (showOptional ? (
          <div className="grid gap-3 sm:grid-cols-2">{optional.map(field)}</div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowOptional(true)}>
            {t("optionalDetails")}
          </Button>
        ))}

      <div className="grid gap-3 sm:grid-cols-2">
        {(manual || ctx.canReassign) && agents.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="assign-to">{t("assignTo")}</Label>
            <NativeSelect id="assign-to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="h-10">
              <option value="">{t("anyAgent")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {pickText(a.displayName, locale)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      {needsConsent && (
        <label className="bg-muted/50 flex items-start gap-2 rounded-lg p-3 text-sm">
          <input
            type="checkbox"
            className="accent-brand mt-0.5 size-5"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{pickText(ctx.privacy.consentText, language)}</span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      )}

      <Button ref={issueRef} type="submit" className="h-14 w-full text-lg" disabled={busy || (needsConsent && !consent)}>
        {busy ? t("issuing") : t("issue")}
      </Button>
    </form>
  );
}
