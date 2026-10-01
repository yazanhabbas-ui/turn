"use client";

import { Bell, CheckCheck, DoorOpen, Minus, Play, Plus, Undo2, UserPlus, UserRoundX, Users, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useErrorMessage } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pickText } from "@/i18n/locales";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Elapsed } from "../queue/bits";
import type { AgentWorkspace, HallConsole, HallSession } from "../queue/types";
import { clampGroupSize, MEMBER_STATUS, noCallReason, OUTCOMES, sessionFlags, stepperMax } from "./hall-helpers";
import { VisitHistory, VisitorInfo } from "./visitor-detail";

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Shortcut letters, with the key that sits at the same place on an Arabic keyboard. */
const KEYS = {
  next: ["n", "N", "ى"],
  entered: ["e", "E", "ث"],
  start: ["s", "S", "س"],
  close: ["c", "C", "ؤ"],
  recall: ["r", "R", "ر"],
};
const is = (e: KeyboardEvent, keys: string[]) => keys.includes(e.key);

type CallResult = {
  session: HallSession | null;
  created: boolean;
  reason: "empty" | "below_min" | "full" | null;
  available: number;
};

/** The host's console for a hall session (D62): call a group, let them in, start, close. */
export function HallPanel({
  data,
  hall,
  blocked,
  onChanged,
}: {
  data: AgentWorkspace;
  hall: HallConsole;
  /** Another dialog is open: keyboard shortcuts stay quiet. */
  blocked: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("agent.hall");
  const ta = useTranslations("agent");
  const locale = useLocale();
  const message = useErrorMessage();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [userSize, setUserSize] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const session = hall.session;
  const target = hall.hall;
  const flags = sessionFlags(hall);
  const limit = stepperMax(hall.maxCall, hall.callable);
  const size = clampGroupSize(userSize ?? limit, limit);
  const blockedReason = noCallReason(hall);
  const reasonOf = (id: string) => data.reasons.find((r) => r.id === id);

  // Every request goes through here: one at a time, errors shown as messages, the screen refreshed afterwards.
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, done?: (r: T) => void) => {
      if (lock.current) return;
      lock.current = true;
      setPending(true);
      setHint(null);
      try {
        const r = await fn();
        done?.(r);
        onChanged();
      } catch (err) {
        toast.error(message(err));
        onChanged();
      } finally {
        lock.current = false;
        setPending(false);
      }
    },
    [onChanged, message],
  );

  const callGroup = useCallback(
    (extra?: number | null) =>
      run(
        () =>
          api<CallResult>("/api/v1/halls/call-group", {
            body: { hallId: target?.id ?? null, size: extra === undefined ? size || null : extra },
          }),
        (r) => {
          setUserSize(null);
          if (r.reason) setHint(t(`callReasons.${r.reason}`, { min: hall.settings.minGroup, count: r.available }));
          else if (r.created && r.session) toast.success(t("calledToast", { count: r.session.tickets.length }));
        },
      ),
    [run, target?.id, size, t, hall.settings.minGroup],
  );

  const act = useCallback(
    (body: Record<string, unknown>, done?: string) => {
      if (!session) return Promise.resolve();
      return run(
        () => api(`/api/v1/halls/sessions/${session.id}/actions`, { body }),
        () => {
          if (done) toast.success(done);
        },
      );
    },
    [run, session],
  );

  const closeSession = (outcome: string | null) => {
    setClosing(false);
    void act({ action: "close", outcome }, t("closedToast"));
  };

  // Enter = the natural next step; N / E / S / C / R as on the legend. Same style as the desk shortcuts.
  const stepRef = useRef<() => void>(() => {});
  stepRef.current = () => {
    if (pending) return;
    if (!session) return void (blockedReason ? undefined : callGroup());
    if (flags.canEnterAll) return void act({ action: "enter" });
    if (flags.startEnabled) return void act({ action: "start" });
    if (flags.canClose) setClosing(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked || closing || cancelling || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" || e.key === "NumpadEnter") {
        e.preventDefault();
        stepRef.current();
      } else if (is(e, KEYS.next) && !session && !blockedReason && !pending) {
        e.preventDefault();
        void callGroup();
      } else if (is(e, KEYS.entered) && flags.canEnterAll && !pending) {
        e.preventDefault();
        void act({ action: "enter" });
      } else if (is(e, KEYS.start) && flags.startEnabled && !pending) {
        e.preventDefault();
        void act({ action: "start" });
      } else if (is(e, KEYS.close) && flags.canClose && !pending) {
        e.preventDefault();
        setClosing(true);
      } else if (is(e, KEYS.recall) && flags.canRecall && !pending) {
        e.preventDefault();
        void act({ action: "recall" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    blocked,
    closing,
    cancelling,
    session,
    blockedReason,
    pending,
    flags.canEnterAll,
    flags.startEnabled,
    flags.canClose,
    flags.canRecall,
    callGroup,
    act,
  ]);

  const members = session?.tickets ?? [];
  const focus = members.find((m) => m.ticket.id === pickedId) ?? members[0] ?? null;
  const hallTitle = target ? `${pickText(target.name, locale)} · ${target.number}` : "";

  return (
    <section className="bg-card flex min-h-[26rem] flex-col rounded-2xl border p-5 shadow-sm" aria-label={t("title")}>
      {/* Hall and seats */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <DoorOpen className="size-4" aria-hidden />
            {t("title")}
          </div>
          <div className="mt-1 text-2xl font-bold">{target ? hallTitle : t("noHall")}</div>
          {session && (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  session.status === "IN_SESSION"
                    ? "bg-status-serving/10 text-status-serving"
                    : "bg-status-called/10 text-status-called",
                )}
              >
                {t(`sessionStatus.${session.status}`)}
              </span>
              <Elapsed since={session.startedAt ?? session.calledAt} className="text-muted-foreground text-sm" />
            </div>
          )}
        </div>
        {target && <SeatGauge occupied={session?.occupied ?? 0} capacity={session?.capacity ?? target.capacity} />}
      </div>

      {!session ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Users className="text-muted-foreground size-12 opacity-40" aria-hidden />
          <p className="text-muted-foreground text-lg">{t("empty")}</p>
          <p className="tabular text-sm">
            {t("waitingNow", { count: hall.waiting })}
            {hall.callable > 0 && <span className="text-muted-foreground"> · {t("callableNow", { count: hall.callable })}</span>}
          </p>
          {blockedReason && target && (
            <p role="status" className="text-muted-foreground text-sm">
              {t(`blocked.${blockedReason}`, { min: hall.settings.minGroup, count: hall.waiting })}
            </p>
          )}
          {hint && (
            <p role="status" className="text-foreground font-medium">
              {hint}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">{t("visitors", { count: members.length })}</h3>
            <ul className="divide-y rounded-xl border" aria-label={t("visitorsAria")}>
              {members.map((m) => {
                const meta = MEMBER_STATUS[m.status];
                const tk = m.ticket;
                return (
                  <li
                    key={tk.id}
                    className={cn("flex flex-wrap items-center gap-2 px-3 py-2", focus?.ticket.id === tk.id && "bg-muted/40")}
                  >
                    <button
                      type="button"
                      onClick={() => setPickedId(tk.id)}
                      aria-pressed={focus?.ticket.id === tk.id}
                      aria-label={t("showDetails", { number: tk.displayNumber })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-start"
                    >
                      <span className="text-brand tabular text-2xl font-bold" dir="ltr">
                        {tk.displayNumber}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {tk.visitor?.name ?? pickText(reasonOf(tk.reasonId)?.name, locale)}
                        </span>
                        {tk.visitor?.returning && (
                          <span className="text-brand text-xs">{ta("visitNumber", { n: tk.visitor.visitCount + 1 })}</span>
                        )}
                      </span>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", meta.tone)}>
                        {t(`member.${meta.key}`)}
                      </span>
                    </button>
                    {(m.status === "CALLED" || m.status === "ENTERED") && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.status === "CALLED" && (
                          <>
                            <Button
                              size="sm"
                              className="h-10"
                              disabled={pending}
                              aria-label={`${t("entered")} ${tk.displayNumber}`}
                              onClick={() => void act({ action: "enter", ticketIds: [tk.id] })}
                            >
                              <CheckCheck aria-hidden />
                              {t("entered")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-10"
                              disabled={pending}
                              aria-label={`${t("noShow")} ${tk.displayNumber}`}
                              onClick={() => void act({ action: "no_show", ticketId: tk.id })}
                            >
                              <UserRoundX aria-hidden />
                              {t("noShow")}
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10"
                          disabled={pending}
                          aria-label={`${t("release")} ${tk.displayNumber}`}
                          title={t("releaseHint")}
                          onClick={() => void act({ action: "release", ticketId: tk.id })}
                        >
                          <Undo2 aria-hidden />
                          {t("release")}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {focus && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <span className="text-brand tabular text-3xl font-bold" dir="ltr">
                  {focus.ticket.displayNumber}
                </span>
                <span className="text-muted-foreground">{pickText(reasonOf(focus.ticket.reasonId)?.name, locale)}</span>
              </div>
              <VisitorInfo ticket={focus.ticket} reason={reasonOf(focus.ticket.reasonId)} />
              {focus.ticket.visitor && (
                <VisitHistory
                  visitor={focus.ticket.visitor}
                  history={data.visitHistory[focus.ticket.visitor.id] ?? []}
                  reasons={data.reasons}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 space-y-3">
        {!session ? (
          <>
            <div className="flex items-stretch gap-3">
              <Button
                className="h-20 flex-1 text-2xl font-bold shadow-md"
                disabled={pending || !target || !!blockedReason}
                title={`${t("keys.next")}`}
                aria-keyshortcuts="N"
                onClick={() => void callGroup()}
              >
                <Bell className="size-7" aria-hidden />
                {pending ? ta("calling") : t("callNext")}
                {size > 0 && <span className="tabular text-lg font-medium opacity-80">· {t("people", { count: size })}</span>}
              </Button>
              {limit > 1 && <SizeStepper value={size} max={limit} onChange={setUserSize} disabled={pending} />}
            </div>
            <p className="text-muted-foreground text-center text-xs">{t("shortcuts")}</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {flags.canEnterAll && (
                <Button
                  className="h-14 text-base"
                  disabled={pending}
                  title={t("keys.entered")}
                  aria-keyshortcuts="E"
                  onClick={() => void act({ action: "enter" })}
                >
                  <CheckCheck aria-hidden />
                  {t("markAllEntered")}
                </Button>
              )}
              {flags.canStart && (
                <Button
                  className="h-14 text-base"
                  variant={flags.canEnterAll ? "outline" : "default"}
                  disabled={pending || !flags.startEnabled}
                  title={flags.startEnabled ? t("keys.start") : t("startNeedsEntered")}
                  aria-keyshortcuts="S"
                  onClick={() => void act({ action: "start" })}
                >
                  <Play aria-hidden />
                  {t("startSession")}
                </Button>
              )}
              {flags.canClose && (
                <Button
                  className="h-14 text-base"
                  variant={flags.canEnterAll || flags.startEnabled ? "outline" : "default"}
                  disabled={pending}
                  title={t("keys.close")}
                  aria-keyshortcuts="C"
                  onClick={() => setClosing(true)}
                >
                  <XCircle aria-hidden />
                  {t("closeSession")}
                </Button>
              )}
              {flags.canRecall && (
                <Button
                  variant="outline"
                  className="h-14 text-base"
                  disabled={pending}
                  title={t("keys.recall")}
                  aria-keyshortcuts="R"
                  onClick={() => void act({ action: "recall" })}
                >
                  <Bell aria-hidden />
                  {t("recallGroup")}
                </Button>
              )}
              {flags.canCancel && (
                <Button variant="outline" className="h-14 text-base" disabled={pending} onClick={() => setCancelling(true)}>
                  <XCircle aria-hidden />
                  {t("cancelSession")}
                </Button>
              )}
            </div>
            {flags.canTopUp && (
              <div className="flex items-stretch gap-3">
                <Button
                  variant="outline"
                  className="h-12 flex-1 text-base"
                  disabled={pending}
                  onClick={() => void act({ action: "top_up", size: userSize ? size : null }, t("toppedUpToast"))}
                >
                  <UserPlus aria-hidden />
                  {t("topUp")}
                  {size > 0 && <span className="tabular opacity-80">· {t("people", { count: size })}</span>}
                </Button>
                {limit > 1 && <SizeStepper value={size} max={limit} onChange={setUserSize} disabled={pending} />}
              </div>
            )}
            <p className="text-muted-foreground text-center text-xs">{t("shortcuts")}</p>
          </>
        )}
      </div>

      <CloseDialog
        open={closing}
        entered={flags.entered}
        notEntered={flags.called}
        onClose={() => setClosing(false)}
        onConfirm={closeSession}
      />
      <Dialog open={cancelling} onOpenChange={(o) => !o && setCancelling(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">{t("cancelBody")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              {t("keepSession")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setCancelling(false);
                void act({ action: "cancel" }, t("cancelledToast"));
              }}
            >
              {t("cancelSession")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SeatGauge({ occupied, capacity }: { occupied: number; capacity: number }) {
  const t = useTranslations("agent.hall");
  const pct = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  return (
    <div className="ms-auto w-full min-w-40 sm:w-56">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{t("seats")}</span>
        <b className="tabular" dir="ltr">
          {occupied} / {capacity}
        </b>
      </div>
      <div
        className="bg-muted mt-1.5 h-3 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={t("seatsAria")}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={occupied}
      >
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-sla-warn" : "bg-brand")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SizeStepper({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations("agent.hall");
  return (
    <div className="flex items-center gap-1 rounded-xl border px-1.5" role="group" aria-label={t("groupSize")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10"
        disabled={disabled || value <= 1}
        aria-label={t("sizeLess")}
        onClick={() => onChange(clampGroupSize(value - 1, max))}
      >
        <Minus aria-hidden />
      </Button>
      <output className="tabular min-w-8 text-center text-lg font-semibold" aria-live="polite">
        {value}
      </output>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10"
        disabled={disabled || value >= max}
        aria-label={t("sizeMore")}
        onClick={() => onChange(clampGroupSize(value + 1, max))}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

function CloseDialog({
  open,
  entered,
  notEntered,
  onClose,
  onConfirm,
}: {
  open: boolean;
  entered: number;
  notEntered: number;
  onClose: () => void;
  onConfirm: (outcome: string | null) => void;
}) {
  const t = useTranslations("agent.hall");
  const ta = useTranslations("agent");
  const tc = useTranslations("common");
  const [outcome, setOutcome] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else setOutcome(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("closeTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(outcome);
            setOutcome(null);
          }}
        >
          <p className="text-muted-foreground text-sm">{t("closeBody", { entered, missing: notEntered })}</p>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("outcomeForAll")}</legend>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={outcome === o}
                  onClick={() => setOutcome(outcome === o ? null : o)}
                  className={cn(
                    "h-10 rounded-full border px-3 text-sm",
                    outcome === o ? "border-brand bg-brand/10 text-brand font-semibold" : "hover:bg-muted",
                  )}
                >
                  {ta(`outcomes.${o}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" autoFocus className="h-11 px-6">
              {t("closeSession")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
