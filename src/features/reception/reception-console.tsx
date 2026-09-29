"use client";

import { CalendarCheck, UsersRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { pickText } from "@/i18n/locales";
import { ConnectionPill, PauseBanner } from "../queue/bits";
import type { QueueState, ReceptionContext, Ticket } from "../queue/types";
import { useLiveQuery } from "../queue/use-queue";
import { AppointmentDialog, type FoundAppointment } from "./appointment-dialog";
import { IssuedDialog } from "./issued-dialog";
import { IssuePanel, ReasonPicker, type IssueResult } from "./issue-panel";
import { LiveQueue } from "./live-queue";
import { PrintTicket, type PrintJob } from "./print-ticket";

const BRANCH_KEY = "dor.reception.branch";
const AUTOPRINT_KEY = "dor.reception.autoPrint";

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
  const [autoPrint, setAutoPrint] = useState(false);
  const [checkIn, setCheckIn] = useState(false);

  useEffect(() => {
    try {
      setBranchId(localStorage.getItem(BRANCH_KEY));
      setAutoPrint(localStorage.getItem(AUTOPRINT_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  // The context (waiting counts, open/closed) refreshes on the same live events as the queue.
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

  const onIssued = useCallback(
    (r: IssueResult) => {
      setIssued(r);
      setSelected(null);
      setAppointment(null);
      void state.refetch();
      void ctx.refetch();
      if (autoPrint) setPrintJob(r);
    },
    [autoPrint, state, ctx],
  );

  // Keyboard: a reason's shortcut key selects it; Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || issued || checkIn || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") return setSelected(null);
      const r = ctx.data?.reasons.find(
        (x) => x.shortcutKey && x.shortcutKey.toLowerCase() === e.key.toLowerCase() && x.open.open,
      );
      if (r) {
        e.preventDefault();
        setSelected(r.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx.data, issued, checkIn]);

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
          {c.canCheckIn && (
            <Button variant="outline" onClick={() => setCheckIn(true)}>
              <CalendarCheck aria-hidden />
              {t("checkIn")}
            </Button>
          )}
        </div>
      </div>
      <PauseBanner paused={c.paused} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="space-y-4">
          <ReasonPicker ctx={c} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
          {reason && (
            <IssuePanel
              ctx={c}
              reason={reason}
              appointmentId={appointment?.id}
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
        onAutoPrint={(v) => {
          setAutoPrint(v);
          try {
            localStorage.setItem(AUTOPRINT_KEY, v ? "1" : "0");
          } catch {
            /* ignore */
          }
        }}
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
