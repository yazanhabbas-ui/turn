"use client";

import { ArrowLeftRight, Bell, CheckCircle2, Coffee, PauseCircle, Phone, Play, UserRoundX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingRows } from "@/components/admin/form";
import { useErrorMessage } from "@/components/admin/use-api";
import { EntityIcon } from "@/components/app/entity-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pickText } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConnectionPill, Elapsed, SlaTimer, StatusBadge } from "../queue/bits";
import type { AgentWorkspace, Ticket } from "../queue/types";
import { useLiveQuery } from "../queue/use-queue";

type Status = AgentWorkspace["profile"]["status"];
const STATUSES: Status[] = ["AVAILABLE", "BUSY", "ON_BREAK", "AWAY", "OFFLINE"];
const STATUS_COLOR: Record<Status, string> = {
  AVAILABLE: "bg-status-serving text-white border-status-serving",
  BUSY: "bg-status-called text-white border-status-called",
  ON_BREAK: "bg-status-hold text-white border-status-hold",
  AWAY: "bg-status-done text-white border-status-done",
  OFFLINE: "bg-status-cancelled text-white border-status-cancelled",
};

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function AgentWorkspaceView() {
  const t = useTranslations("agent");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const message = useErrorMessage();
  const [branchId, setBranchId] = useState<string | null>(null);
  const ws = useLiveQuery<AgentWorkspace>(["agent-ws"], "/api/v1/queue/agent", branchId);
  useEffect(() => setBranchId(ws.data?.branch.id ?? null), [ws.data?.branch.id]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<Ticket | null>(null);
  const [transferFor, setTransferFor] = useState<Ticket | null>(null);
  const [breakPicker, setBreakPicker] = useState(false);

  const refresh = useCallback(() => void ws.refetch(), [ws]);

  const action = useCallback(
    async (ticket: Ticket, body: Record<string, unknown>, done?: string, undoable = false) => {
      setBusy(true);
      try {
        await api(`/api/v1/queue/tickets/${ticket.id}/actions`, { body });
        refresh();
        if (done) {
          toast.success(
            done,
            undoable
              ? {
                  duration: 8000,
                  action: {
                    label: tq("undo"),
                    onClick: () =>
                      void api(`/api/v1/queue/tickets/${ticket.id}/actions`, { body: { action: "undo" } }).then(refresh, (e) =>
                        toast.error(message(e)),
                      ),
                  },
                }
              : undefined,
          );
        }
      } catch (err) {
        toast.error(message(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh, message, tq],
  );

  const setStatus = useCallback(
    async (status: Status, extra: Record<string, unknown> = {}) => {
      try {
        await api("/api/v1/queue/agent/status", { body: { status, ...extra } });
        refresh();
      } catch (err) {
        toast.error(message(err));
      }
    },
    [refresh, message],
  );

  const callNext = useCallback(async () => {
    setBusy(true);
    setHint(null);
    try {
      const deskId = ws.data?.profile.currentDeskId ?? ws.data?.profile.defaultDeskId ?? null;
      const r = await api<{ ticket: Ticket | null; reason: string | null }>("/api/v1/queue/call-next", { body: { deskId } });
      if (!r.ticket && r.reason) setHint(t.has(`reasons.${r.reason}`) ? t(`reasons.${r.reason}`) : r.reason);
      refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }, [ws.data, refresh, message, t]);

  const data = ws.data;
  const current = data?.active[0] ?? null;

  const primary = useCallback(() => {
    if (busy || !data) return;
    if (!current) return void callNext();
    if (current.status === "CALLED") return void action(current, { action: "start" });
    if (current.status === "SERVING") setCompleteFor(current);
  }, [busy, data, current, callNext, action]);

  // Keyboard / USB call button: Enter = primary action, R = recall.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || completeFor || transferFor || breakPicker || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" || e.key === "NumpadEnter") {
        e.preventDefault();
        primary();
      } else if ((e.key === "r" || e.key === "R" || e.key === "ر") && current?.status === "CALLED") {
        e.preventDefault();
        void action(current, { action: "recall" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, current, action, completeFor, transferFor, breakPicker]);

  if (ws.isLoading) return <LoadingRows rows={6} />;
  if (ws.error instanceof ApiError && ws.error.details?.reason === "not_an_agent") return <NotAnAgent />;
  if (ws.isError || !data) return <ErrorState onRetry={refresh} />;

  const reasonOf = (id: string) => data.reasons.find((r) => r.id === id);
  const deskId = data.profile.currentDeskId ?? data.profile.defaultDeskId ?? "";
  const breakType = data.breakTypes.find((b) => b.id === data.profile.breakTypeId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Status bar */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("status")}>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={data.profile.status === s}
              onClick={() => (s === "ON_BREAK" && data.breakTypes.length ? setBreakPicker(true) : void setStatus(s))}
              className={cn(
                "h-10 rounded-full border px-4 text-sm font-medium transition",
                data.profile.status === s ? STATUS_COLOR[s] : "hover:bg-muted",
              )}
            >
              {t(`statuses.${s}`)}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs">{t(`statusHint.${data.profile.status}`)}</span>
        {data.profile.status === "ON_BREAK" && (
          <span className="bg-status-hold/10 text-status-hold inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm">
            <Coffee className="size-4" aria-hidden />
            {breakType && pickText(breakType.name, locale)} · <Elapsed since={data.profile.statusChangedAt} />
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          <Label htmlFor="agent-desk" className="text-sm">
            {t("desk")}
          </Label>
          <NativeSelect
            id="agent-desk"
            className="h-10 w-40"
            value={deskId}
            onChange={(e) =>
              void setStatus(data.profile.status === "OFFLINE" ? "AVAILABLE" : data.profile.status, { deskId: e.target.value })
            }
          >
            {!deskId && <option value="">{t("chooseDesk")}</option>}
            {data.desks.map((d) => (
              <option key={d.id} value={d.id}>
                {pickText(d.name, locale)}
              </option>
            ))}
          </NativeSelect>
          <ConnectionPill state={ws.connection} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* Current visitor */}
        <section className="bg-card flex min-h-[26rem] flex-col rounded-2xl border p-5 shadow-sm" aria-label={t("current")}>
          {current ? (
            <CurrentTicket ticket={current} reason={reasonOf(current.reasonId)} />
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <Bell className="size-12 opacity-40" aria-hidden />
              <p className="text-lg">{t("empty")}</p>
              {hint && (
                <p role="status" className="text-foreground font-medium">
                  {hint}
                </p>
              )}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <Button
              className="h-20 w-full text-2xl font-bold shadow-md"
              disabled={busy || (!current && !deskId)}
              onClick={primary}
            >
              {!current ? (
                <>
                  <Bell className="size-7" aria-hidden />
                  {busy ? t("calling") : t("callNext")}
                </>
              ) : current.status === "CALLED" ? (
                <>
                  <Play className="size-7" aria-hidden />
                  {t("start")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-7" aria-hidden />
                  {t("complete")}
                </>
              )}
            </Button>
            {current && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {current.status === "CALLED" && (
                  <>
                    <Button
                      variant="outline"
                      className="h-12"
                      disabled={busy}
                      onClick={() => void action(current, { action: "recall" })}
                    >
                      <Bell aria-hidden />
                      {t("recall")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12"
                      disabled={busy}
                      onClick={() =>
                        void action(current, { action: "no_show" }, t("noShowDone", { number: current.displayNumber }), true)
                      }
                    >
                      <UserRoundX aria-hidden />
                      {t("noShow")}
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  className="h-12"
                  disabled={busy}
                  onClick={() => void action(current, { action: "hold" })}
                >
                  <PauseCircle aria-hidden />
                  {t("hold")}
                </Button>
                <Button variant="outline" className="h-12" disabled={busy} onClick={() => setTransferFor(current)}>
                  <ArrowLeftRight aria-hidden />
                  {t("transfer")}
                </Button>
              </div>
            )}
            <p className="text-muted-foreground text-center text-xs">{t("shortcuts")}</p>
          </div>
        </section>

        {/* Side: my queues, reserved, on hold */}
        <aside className="space-y-4">
          <section className="bg-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">{t("myQueues")}</h2>
              <span className="text-muted-foreground text-xs">
                {t("servedToday")}: <b className="tabular text-foreground">{data.profile.servedToday}</b>
              </span>
            </div>
            <ul className="space-y-2">
              {data.queues.map((q) => {
                const r = reasonOf(q.reasonId);
                return (
                  <li key={q.reasonId} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r?.color }} aria-hidden />
                    <span className="flex-1 truncate">
                      {pickText(r?.name, locale)}{" "}
                      {!q.primary && <span className="text-muted-foreground text-xs">({t("backup")})</span>}
                    </span>
                    <span className="tabular font-semibold">{t("waitingCount", { count: q.waiting })}</span>
                    {q.waiting > 0 && (
                      <span className="text-muted-foreground tabular text-xs">{t("oldest", { min: q.oldestWaitMinutes })}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {data.reserved.length > 0 && (
            <section className="bg-card rounded-2xl border p-4 shadow-sm">
              <h2 className="mb-2 font-semibold">{t("reserved")}</h2>
              <ul className="space-y-3">
                {data.reserved.map((x) => (
                  <li key={x.id}>
                    <div className="flex items-center justify-between">
                      <span className="tabular font-bold" dir="ltr">
                        {x.displayNumber}
                      </span>
                      <span className="text-muted-foreground text-xs">{pickText(reasonOf(x.reasonId)?.name, locale)}</span>
                    </div>
                    <SlaTimer since={x.arrivedAt} slaMinutes={reasonOf(x.reasonId)?.slaTargetWaitMinutes ?? 15} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.onHold.length > 0 && (
            <section className="bg-card rounded-2xl border p-4 shadow-sm">
              <h2 className="mb-2 font-semibold">{t("onHold")}</h2>
              <ul className="space-y-2">
                {data.onHold.map((x) => (
                  <li key={x.id} className="flex items-center gap-2">
                    <span className="tabular font-bold" dir="ltr">
                      {x.displayNumber}
                    </span>
                    <span className="text-muted-foreground flex-1 truncate text-xs">{x.visitor?.name}</span>
                    <Button size="sm" variant="outline" onClick={() => void action(x, { action: "resume" })}>
                      <Play aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <BreakPicker
        open={breakPicker}
        breakTypes={data.breakTypes}
        onClose={() => setBreakPicker(false)}
        onPick={(id) => {
          setBreakPicker(false);
          void setStatus("ON_BREAK", { breakTypeId: id });
        }}
      />
      <CompleteDialog
        ticket={completeFor}
        onClose={() => setCompleteFor(null)}
        onConfirm={(body) => {
          const tk = completeFor!;
          setCompleteFor(null);
          void action(tk, { action: "complete", ...body }, t("completed", { number: tk.displayNumber }), true);
        }}
      />
      <TransferDialog
        ticket={transferFor}
        data={data}
        onClose={() => setTransferFor(null)}
        onConfirm={(body) => {
          const tk = transferFor!;
          setTransferFor(null);
          void action(tk, { action: "transfer", ...body }, t("transferred", { number: tk.displayNumber }));
        }}
      />
    </div>
  );
}

/** Shown to users whose role allows serving visitors but who have no agent profile (desk, capacity) yet. */
function NotAnAgent() {
  const t = useTranslations("agent");
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <UserRoundX className="text-muted-foreground mx-auto size-12" aria-hidden />
      <h1 className="mt-4 text-xl font-bold">{t("notAgentTitle")}</h1>
      <p className="text-muted-foreground mt-2">{t("notAgentBody")}</p>
      <Button className="mt-6" nativeButton={false} render={<Link href="/admin/users" />}>
        {t("notAgentAction")}
      </Button>
    </div>
  );
}

function CurrentTicket({ ticket, reason }: { ticket: Ticket; reason: AgentWorkspace["reasons"][number] | undefined }) {
  const t = useTranslations("agent");
  const tu = useTranslations("ui");
  const tq = useTranslations("queue");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const label = (key: string) => {
    if (tr.has(`intakeFields.${key}`)) return tr(`intakeFields.${key}`);
    return pickText(reason?.intakeFields.find((f) => f.key === key)?.label, locale, key);
  };
  const waitedMs = new Date(ticket.calledAt ?? ticket.arrivedAt).getTime() - new Date(ticket.arrivedAt).getTime();
  const sla = reason?.slaTargetWaitMinutes ?? 15;
  const slaColor = waitedMs >= sla * 60_000 ? "text-sla-breach" : waitedMs >= sla * 48_000 ? "text-sla-warn" : "text-sla-ok";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="text-brand tabular text-6xl leading-none font-bold" dir="ltr">
            {ticket.displayNumber}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} />
            {ticket.recallCount > 0 && (
              <span className="text-muted-foreground text-xs">{t("recallCount", { count: ticket.recallCount })}</span>
            )}
            {ticket.visitor?.returning && (
              <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-xs font-medium">{tq("returning")}</span>
            )}
            {ticket.appointmentId && <span className="bg-muted rounded-full px-2 py-0.5 text-xs">{tq("appointment")}</span>}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl text-white" style={{ backgroundColor: reason?.color }}>
            <EntityIcon name={reason?.icon} className="size-5" />
          </span>
          <span className="text-lg font-semibold">{pickText(reason?.name, locale)}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-muted/40 rounded-xl p-3">
          <div className="text-muted-foreground text-xs">{t("waitedFor")}</div>
          <div className={cn("tabular text-xl font-semibold", slaColor)}>
            <span dir="ltr">{Math.round(waitedMs / 60_000)}</span> <span className="text-sm">{tu("minutes")}</span>
          </div>
          <div className="text-muted-foreground text-xs">{tq("sla", { min: sla })}</div>
        </div>
        <div className="bg-muted/40 rounded-xl p-3">
          <div className="text-muted-foreground text-xs">{ticket.status === "SERVING" ? tq("serving") : t("calledAt")}</div>
          <Elapsed since={ticket.status === "SERVING" ? ticket.startedAt : ticket.calledAt} className="text-xl font-semibold" />
        </div>
      </div>

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
                  <a
                    href={`tel:${ticket.visitor.phone}`}
                    className="text-brand inline-flex items-center gap-1 text-base"
                    dir="ltr"
                  >
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
    </div>
  );
}

function BreakPicker({
  open,
  breakTypes,
  onClose,
  onPick,
}: {
  open: boolean;
  breakTypes: AgentWorkspace["breakTypes"];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("agent");
  const locale = useLocale();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("breakType")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {breakTypes.map((b) => (
            <Button key={b.id} variant="outline" className="h-12 justify-start text-base" onClick={() => onPick(b.id)}>
              <Coffee aria-hidden />
              {pickText(b.name, locale)}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOMES = ["resolved", "follow_up", "referred", "info"] as const;

function CompleteDialog({
  ticket,
  onClose,
  onConfirm,
}: {
  ticket: Ticket | null;
  onClose: () => void;
  onConfirm: (b: { outcome?: string; notes?: string; tags?: string[] }) => void;
}) {
  const t = useTranslations("agent");
  const tc = useTranslations("common");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [for_, setFor] = useState<string | null>(null);
  if (ticket && for_ !== ticket.id) {
    setFor(ticket.id);
    setOutcome(null);
    setNotes(ticket.notes ?? "");
    setTags("");
  }
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ticket && t("completeTitle", { number: ticket.displayNumber })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm({
              outcome: outcome ?? undefined,
              notes: notes || undefined,
              tags: tags
                .split(/[,،]/)
                .map((x) => x.trim())
                .filter(Boolean),
            });
          }}
        >
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("outcome")}</legend>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(outcome === o ? null : o)}
                  className={cn(
                    "h-10 rounded-full border px-3 text-sm",
                    outcome === o ? "border-brand bg-brand/10 text-brand font-semibold" : "hover:bg-muted",
                  )}
                >
                  {t(`outcomes.${o}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">{t("notes")}</Label>
            <Textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-tags">{t("tags")}</Label>
            <Input id="c-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" autoFocus className="h-11 px-6">
              {t("complete")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  ticket,
  data,
  onClose,
  onConfirm,
}: {
  ticket: Ticket | null;
  data: AgentWorkspace;
  onClose: () => void;
  onConfirm: (b: { toReasonId?: string; toAgentId?: string | null; note?: string }) => void;
}) {
  const t = useTranslations("agent");
  const ts = useTranslations("agent.statuses");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [reasonId, setReasonId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  const [for_, setFor] = useState<string | null>(null);
  if (ticket && for_ !== ticket.id) {
    setFor(ticket.id);
    setReasonId(ticket.reasonId);
    setAgentId("");
    setNote("");
  }
  const agents = data.agents.filter((a) => a.reasons.includes(reasonId));
  const changed = ticket && (reasonId !== ticket.reasonId || agentId);
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ticket && t("transferTitle", { number: ticket.displayNumber })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="t-reason">{t("toReason")}</Label>
            <NativeSelect id="t-reason" value={reasonId} onChange={(e) => (setReasonId(e.target.value), setAgentId(""))}>
              {data.reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {pickText(r.name, locale)}
                  {ticket && r.id === ticket.reasonId ? ` (${t("sameReason")})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-agent">{t("toAgent")}</Label>
            <NativeSelect id="t-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">—</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {pickText(a.displayName, locale)} · {ts(a.status as "AVAILABLE")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-note">{t("transferNote")}</Label>
            <Textarea id="t-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={!changed}
            onClick={() =>
              onConfirm({
                toReasonId: ticket && reasonId !== ticket.reasonId ? reasonId : undefined,
                toAgentId: agentId || null,
                note: note || undefined,
              })
            }
          >
            {t("transfer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
