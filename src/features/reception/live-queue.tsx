"use client";

import { CalendarCheck, MoreVertical, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useErrorMessage } from "@/components/admin/use-api";
import { AgentPicker } from "@/components/admin/agent-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { pickText } from "@/i18n/locales";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { queueAgentOptions } from "../queue/agent-options";
import { CallCode, Elapsed, StatusBadge } from "../queue/bits";
import type { QueueState, ReceptionContext, Ticket } from "../queue/types";

type Filter = "active" | "waiting" | "called" | "done" | "all";
const ACTIVE = new Set(["WAITING", "CALLED", "SERVING", "ON_HOLD", "APPOINTMENT_PENDING"]);
const DONE = new Set(["COMPLETED", "NO_SHOW", "CANCELLED"]);

async function act(ticketId: string, body: Record<string, unknown>) {
  return api<{ ticket: Ticket }>(`/api/v1/queue/tickets/${ticketId}/actions`, { body });
}

export function LiveQueue({
  ctx,
  state,
  onReprint,
  onChanged,
}: {
  ctx: ReceptionContext;
  state: QueueState | undefined;
  onReprint: (t: Ticket) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("reception");
  const tq = useTranslations("queue");
  const locale = useLocale();
  const message = useErrorMessage();
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Ticket | null>(null);
  const [assign, setAssign] = useState<Ticket | null>(null);

  const rows = useMemo(() => {
    if (!state) return [];
    const order = new Map(state.waitingOrder.map((id, i) => [id, i]));
    let list = state.tickets.filter((x) =>
      filter === "all"
        ? true
        : filter === "active"
          ? ACTIVE.has(x.status)
          : filter === "waiting"
            ? x.status === "WAITING"
            : filter === "called"
              ? x.status === "CALLED" || x.status === "SERVING"
              : DONE.has(x.status),
    );
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (x) =>
          x.displayNumber.toLowerCase().includes(s) ||
          (x.visitor?.name ?? "").toLowerCase().includes(s) ||
          (x.visitor?.phone ?? "").includes(s),
      );
    }
    const rank = (x: Ticket) =>
      x.status === "CALLED" ? 0 : x.status === "SERVING" ? 1 : x.status === "WAITING" ? 2 : x.status === "ON_HOLD" ? 3 : 4;
    return [...list].sort(
      (a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || b.arrivedAt.localeCompare(a.arrivedAt),
    );
  }, [state, filter, q]);

  const reasonOf = (id: string) => ctx.reasons.find((r) => r.id === id);
  const agentName = (id: string | null) => (id ? pickText(ctx.agents.find((a) => a.id === id)?.displayName, locale) : "");

  async function run(ticket: Ticket, body: Record<string, unknown>, success?: string, undoable = false) {
    try {
      await act(ticket.id, body);
      onChanged();
      if (success)
        toast.success(
          success,
          undoable
            ? {
                action: {
                  label: tq("undo"),
                  onClick: () =>
                    void act(ticket.id, { action: "undo" }).then(
                      () => (onChanged(), toast.success(tq("undone"))),
                      (e) => toast.error(message(e)),
                    ),
                },
                duration: 8000,
              }
            : undefined,
        );
    } catch (err) {
      toast.error(err instanceof ApiError ? message(err) : tq("actionFailed"));
    }
  }

  const filters: Filter[] = ["active", "waiting", "called", "done", "all"];
  return (
    <section className="bg-card flex min-h-0 flex-col rounded-2xl border shadow-sm" aria-label={t("liveQueue")}>
      <div className="space-y-3 border-b p-4">
        <h2 className="text-lg font-semibold">{t("liveQueue")}</h2>
        <div className="flex flex-wrap gap-1" role="tablist">
          {filters.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-sm",
                filter === f ? "bg-brand text-white" : "bg-muted hover:bg-muted/70",
              )}
            >
              {t(`filters.${f}`)}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-2.5 size-4" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchQueue")}
            aria-label={t("searchQueue")}
            className="ps-8"
          />
        </div>
      </div>
      <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
        {!rows.length && (
          <li className="text-muted-foreground p-8 text-center text-sm">{state?.tickets.length ? t("noMatch") : t("empty")}</li>
        )}
        {rows.map((x) => {
          const reason = reasonOf(x.reasonId);
          const pos = state?.positions[x.id];
          const priority = x.priorityKey ? ctx.priorities.find((p) => p.key === x.priorityKey) : null;
          return (
            <li key={x.id} className={cn("flex items-center gap-3 px-4 py-3", x.status === "CALLED" && "bg-status-called/5")}>
              <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: reason?.color }} aria-hidden />
              <div className="w-20 shrink-0">
                <div className="tabular text-lg font-bold" dir="ltr">
                  {x.displayNumber}
                </div>
                <CallCode code={x.callCode} className="mt-0.5" />
                {priority && priority.key !== "normal" && (
                  <span className="rounded px-1 text-[10px] font-semibold text-white" style={{ backgroundColor: priority.color }}>
                    {pickText(priority.name, locale)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.visitor?.name || pickText(reason?.name, locale)}</div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                  {x.visitor?.name && <span className="truncate">{pickText(reason?.name, locale)}</span>}
                  {x.status === "WAITING" && pos && <span>{tq("ahead", { count: pos.ahead })}</span>}
                  {x.assignedAgentId && x.status === "WAITING" && <span>→ {agentName(x.assignedAgentId)}</span>}
                  {(x.status === "CALLED" || x.status === "SERVING") && <span>{agentName(x.servingAgentId)}</span>}
                  {x.appointmentId && (
                    <span className="inline-flex items-center gap-0.5">
                      <CalendarCheck className="size-3" aria-hidden />
                      {tq("appointment")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={x.status} />
                {ACTIVE.has(x.status) && <Elapsed since={x.arrivedAt} className="text-muted-foreground text-xs" />}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions")} />}>
                  <MoreVertical aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onReprint(x)}>{t("reprint")}</DropdownMenuItem>
                  {ctx.canEdit && ACTIVE.has(x.status) && (
                    <DropdownMenuItem onClick={() => setEdit(x)}>{t("edit")}</DropdownMenuItem>
                  )}
                  {x.status === "WAITING" && (ctx.canReassign || ctx.modes[x.reasonId] === "manual") && (
                    <DropdownMenuItem onClick={() => setAssign(x)}>{t("assign")}</DropdownMenuItem>
                  )}
                  {ctx.canEdit && x.status === "WAITING" && (
                    <DropdownMenuItem onClick={() => void run(x, { action: "hold" })}>{t("hold")}</DropdownMenuItem>
                  )}
                  {x.status === "ON_HOLD" && (
                    <DropdownMenuItem onClick={() => void run(x, { action: "resume" })}>{t("resume")}</DropdownMenuItem>
                  )}
                  {ctx.canCancel && ["WAITING", "CALLED", "ON_HOLD", "APPOINTMENT_PENDING"].includes(x.status) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void run(x, { action: "cancel" }, t("cancelled", { number: x.displayNumber }), true)}
                      >
                        {t("cancel")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      <EditDialog
        ticket={edit}
        ctx={ctx}
        onClose={() => setEdit(null)}
        onSave={(body) => edit && run(edit, { action: "edit", ...body }).then(() => setEdit(null))}
      />
      <AssignDialog
        ticket={assign}
        ctx={ctx}
        onClose={() => setAssign(null)}
        onSave={(agentId) => assign && run(assign, { action: "assign", agentId }).then(() => setAssign(null))}
      />
    </section>
  );
}

function EditDialog({
  ticket,
  ctx,
  onClose,
  onSave,
}: {
  ticket: Ticket | null;
  ctx: ReceptionContext;
  onClose: () => void;
  onSave: (b: { priorityKey: string | null; notes: string | null }) => void;
}) {
  const t = useTranslations("reception");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (ticket && loadedFor !== ticket.id) {
    setLoadedFor(ticket.id);
    setPriority(ticket.priorityKey ?? "normal");
    setNotes(ticket.notes ?? "");
  }
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ticket && t("editTitle", { number: ticket.displayNumber })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-priority">{t("priority")}</Label>
            <NativeSelect id="e-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {ctx.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {pickText(p.name, locale)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-notes">{t("notes")}</Label>
            <Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => onSave({ priorityKey: priority === "normal" ? null : priority, notes: notes || null })}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  ticket,
  ctx,
  onClose,
  onSave,
}: {
  ticket: Ticket | null;
  ctx: ReceptionContext;
  onClose: () => void;
  onSave: (agentId: string | null) => void;
}) {
  const t = useTranslations("reception");
  const ta = useTranslations("agent");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [agentId, setAgentId] = useState("");
  const agents = ticket ? ctx.agents.filter((a) => a.reasons.includes(ticket.reasonId)) : [];
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ticket && t("assignTitle", { number: ticket.displayNumber })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="a-agent">{t("agent")}</Label>
          <AgentPicker
            id="a-agent"
            options={queueAgentOptions(agents, locale, (s) => ta(`statuses.${s}` as "statuses.AVAILABLE"))}
            value={agentId}
            onChange={setAgentId}
            placeholder={t("release")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => onSave(agentId || null)}>{tc("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
