"use client";

import { CalendarCheck, UsersRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { useErrorMessage } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import { ApiError } from "@/lib/api";
import { ConnectionPill } from "../queue/bits";
import type { QueueState, ReceptionContext, Ticket } from "../queue/types";
import { useLiveQuery } from "../queue/use-queue";
import { AppointmentDialog, type FoundAppointment } from "./appointment-dialog";
import { IssuedDialog } from "./issued-dialog";
import { IssuePanel, ReasonPicker, issueRequest, newKey, type IssueResult } from "./issue-panel";
import { LiveQueue } from "./live-queue";
import { PrintTicket, type PrintJob } from "./print-ticket";
import { IssuedBanner, QuickBar } from "./quick-bar";

const BRANCH_KEY = "dor.reception.branch";
const AUTOPRINT_KEY = "dor.reception.autoPrint";
const LANGUAGE_KEY = "dor.reception.language";

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function ReceptionConsole() {
  const t = useTranslations("reception");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<FoundAppointment | null>(null);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  // null = follow the organization default; a reception PC without a printer can switch it off for itself.
  const [autoPrintOverride, setAutoPrintOverride] = useState<boolean | null>(null);
  const [last, setLast] = useState<IssueResult | null>(null);
  const [priorityKey, setPriorityKey] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const issuing = useRef(false);
  const message = useErrorMessage();
  const [checkIn, setCheckIn] = useState(false);

  useEffect(() => {
    try {
      setBranchId(localStorage.getItem(BRANCH_KEY));
      const v = localStorage.getItem(AUTOPRINT_KEY);
      setAutoPrintOverride(v === "1" ? true : v === "0" ? false : null);
      setLanguage(localStorage.getItem(LANGUAGE_KEY));
    } catch {
      /* private mode */
    }
  }, []);

  // The context (waiting counts) refreshes on the same live events as the queue.
  const [liveBranch, setLiveBranch] = useState<string | null>(null);
  const ctx = useLiveQuery<ReceptionContext>(
    ["reception-ctx", branchId],
    `/api/v1/queue/reception${branchId ? `?branchId=${branchId}` : ""}`,
    liveBranch,
  );
  const activeBranch = ctx.data?.branch.id ?? null;
  useEffect(() => setLiveBranch(activeBranch), [activeBranch]);
  const state = useLiveQuery<QueueState>(
    ["queue-state", activeBranch],
    activeBranch ? `/api/v1/queue/state?branchId=${activeBranch}` : null,
    activeBranch,
  );
  const reason = useMemo(() => ctx.data?.reasons.find((r) => r.id === selected) ?? null, [ctx.data, selected]);

  const setAutoPrint = (v: boolean) => {
    setAutoPrintOverride(v);
    try {
      localStorage.setItem(AUTOPRINT_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const reception = ctx.data?.reception;
  const autoPrint = autoPrintOverride ?? reception?.autoPrint ?? false;
  const visitorLanguage =
    language ?? (reception?.defaultLanguage === "ar" || reception?.defaultLanguage === "en" ? reception.defaultLanguage : locale);

  const onIssued = useCallback(
    (r: IssueResult) => {
      setSelected(null);
      setAppointment(null);
      setPriorityKey(null);
      if (reception?.afterIssue === "dialog") setIssued(r);
      else setLast(r);
      void state.refetch();
      void ctx.refetch();
      if (autoPrint) setPrintJob(r);
    },
    [autoPrint, state, ctx, reception?.afterIssue],
  );

  // The fast path: a reason with nothing to type issues on the first tap.
  const issueNow = useCallback(
    async (r: NonNullable<typeof reason>) => {
      const c = ctx.data;
      if (!c || issuing.current) return;
      issuing.current = true;
      try {
        onIssued(await issueRequest(c, r, { priorityKey, language: visitorLanguage, idempotencyKey: newKey() }));
      } catch (err) {
        // Anything the quick path cannot settle by itself (a missing field, a rule) opens the form with the message.
        if (err instanceof ApiError && (err.details?.reason === "missing_field" || err.details?.reason === "invalid_field")) {
          setSelected(r.id);
        } else toast.error(message(err));
      } finally {
        issuing.current = false;
      }
    },
    [ctx.data, onIssued, priorityKey, visitorLanguage, message],
  );

  const pick = useCallback(
    (id: string) => {
      const r = ctx.data?.reasons.find((x) => x.id === id);
      if (!r || !ctx.data) return;
      const needsForm =
        !ctx.data.reception.oneTapIssue ||
        !!appointment ||
        r.intakeFields.some((f) => f.required) ||
        ctx.data.modes[r.id] === "manual";
      if (needsForm) setSelected((cur) => (cur === id ? null : id));
      else void issueNow(r);
    },
    [ctx.data, appointment, issueNow],
  );

  // Keyboard: a reason's shortcut key selects it; Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || issued || checkIn || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") return setSelected(null);
      const r = ctx.data?.reasons.find((x) => x.shortcutKey && x.shortcutKey.toLowerCase() === e.key.toLowerCase());
      if (r) {
        e.preventDefault();
        pick(r.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx.data, issued, checkIn, pick]);

  if (ctx.isLoading) return <LoadingRows rows={6} />;
  if (ctx.isError || !ctx.data) return <ErrorState onRetry={() => ctx.refetch()} />;
  const c = ctx.data;
  const tickets = state.data?.tickets ?? [];
  const waiting = tickets.filter((x) => x.status === "WAITING").length;
  const serving = tickets.filter((x) => x.status === "CALLED" || x.status === "SERVING").length;
  const available = c.agents.filter((a) => a.status === "AVAILABLE").length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {c.branches.length > 1 && (
          <NativeSelect
            aria-label={t("branch")}
            className="w-auto"
            value={c.branch.id}
            onChange={(e) => {
              setBranchId(e.target.value);
              setSelected(null);
              try {
                localStorage.setItem(BRANCH_KEY, e.target.value);
              } catch {
                /* ignore */
              }
            }}
          >
            {c.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {pickText(b.name, locale)}
              </option>
            ))}
          </NativeSelect>
        )}
        <ConnectionPill state={state.connection} />
        <div className="text-muted-foreground ms-auto flex flex-wrap items-center gap-4 text-sm">
          <span>
            {tq("waiting")}: <b className="text-foreground tabular">{waiting}</b>
          </span>
          <span>
            {tq("serving")}: <b className="text-foreground tabular">{serving}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <UsersRound className="size-4" aria-hidden />
            {tq("agentsAvailable")}: <b className="text-foreground tabular">{available}</b>
          </span>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
            />
            {t("autoPrint")}
          </label>
          {c.canCheckIn && (
            <Button variant="outline" onClick={() => setCheckIn(true)}>
              <CalendarCheck aria-hidden />
              {t("checkIn")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="space-y-4">
          <IssuedBanner result={last} ctx={c} onPrint={() => last && setPrintJob(last)} onDismiss={() => setLast(null)} />
          <QuickBar
            ctx={c}
            priorityKey={priorityKey}
            onPriority={setPriorityKey}
            language={visitorLanguage}
            onLanguage={(code) => {
              setLanguage(code);
              try {
                localStorage.setItem(LANGUAGE_KEY, code);
              } catch {
                /* ignore */
              }
            }}
          />
          <ReasonPicker ctx={c} selected={selected} onSelect={pick} />
          {reason && (
            <IssuePanel
              ctx={c}
              reason={reason}
              appointmentId={appointment?.id}
              priorityKey={priorityKey}
              language={visitorLanguage}
              onIssued={onIssued}
              onClear={() => (setSelected(null), setAppointment(null))}
            />
          )}
        </div>
        <div className="lg:sticky lg:top-18 lg:h-[calc(100dvh-6rem)]">
          <LiveQueue
            ctx={c}
            state={state.data}
            onChanged={() => void state.refetch()}
            onReprint={(tk: Ticket) =>
              setPrintJob({ ticket: tk, ...(state.data?.positions[tk.id] ?? { ahead: 0, estimatedWaitMinutes: 0 }) })
            }
          />
        </div>
      </div>

      <IssuedDialog
        result={issued}
        ctx={c}
        autoPrint={autoPrint}
        onAutoPrint={setAutoPrint}
        onPrint={() => issued && setPrintJob(issued)}
        onClose={() => setIssued(null)}
      />
      <AppointmentDialog
        open={checkIn}
        branchId={c.branch.id}
        onClose={() => setCheckIn(false)}
        onFound={(a) => {
          setCheckIn(false);
          setAppointment(a);
          setSelected(a.reason.id);
        }}
      />
      <PrintTicket job={printJob} ctx={c} onDone={() => setPrintJob(null)} />
    </div>
  );
}
