"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState, ErrorState, Field, LoadingRows } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "@/domain/notifications/policy";
import { useText } from "../use-lookups";

type Row = {
  id: string;
  branchName: Record<string, string> | null;
  ticketNumber: string | null;
  channel: string;
  provider: string;
  event: string;
  recipientMasked: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  error: string | null;
  attempts: number;
  createdAt: string;
};
type Page = { items: Row[]; next: string | null };
const STATUSES = ["queued", "sending", "sent", "failed", "skipped"] as const;
const LOG = "/api/v1/admin/notifications/log";

/** Delivery log: masked recipients only. Filter, and put failed messages back in the queue. */
export function LogTab() {
  const t = useTranslations("notifications");
  const fmt = useFormatter();
  const text = useText();
  const qc = useQueryClient();
  const [f, setF] = useState({ status: "", channel: "", event: "", from: "", to: "" });
  const qs = (before?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (!v) continue;
      // Date inputs are whole days: include the whole "to" day.
      p.set(k, k === "to" ? new Date(`${v}T23:59:59`).toISOString() : k === "from" ? new Date(`${v}T00:00:00`).toISOString() : v);
    }
    if (before) p.set("before", before);
    return p.toString();
  };
  const q = useInfiniteQuery<Page>({
    queryKey: [LOG, f],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page>(`${LOG}?${qs(pageParam as string | undefined)}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const resend = useApiMutation((id: string) => api(`${LOG}/${id}`, { method: "POST" }), {
    success: t("log.resent"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [LOG] }),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label={t("log.status")} htmlFor="nl-status">
          <NativeSelect id="nl-status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">{t("log.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`log.statuses.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("log.channel")} htmlFor="nl-channel">
          <NativeSelect id="nl-channel" value={f.channel} onChange={(e) => set({ channel: e.target.value })}>
            <option value="">{t("log.all")}</option>
            {NOTIFICATION_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`channels.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("log.event")} htmlFor="nl-event">
          <NativeSelect id="nl-event" value={f.event} onChange={(e) => set({ event: e.target.value })}>
            <option value="">{t("log.all")}</option>
            {NOTIFICATION_EVENTS.map((e) => (
              <option key={e} value={e}>
                {t(`events.names.${e}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("log.from")} htmlFor="nl-from">
          <Input id="nl-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label={t("log.to")} htmlFor="nl-to">
          <Input id="nl-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>
      {q.isLoading ? (
        <LoadingRows rows={5} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("log.empty")} />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("log.when")}</TableHead>
                <TableHead>{t("log.ticket")}</TableHead>
                <TableHead>{t("log.event")}</TableHead>
                <TableHead>{t("log.channel")}</TableHead>
                <TableHead>{t("log.recipient")}</TableHead>
                <TableHead>{t("log.status")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmt.dateTime(new Date(r.createdAt), { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{r.ticketNumber ?? "—"}</span>
                    {r.branchName && <span className="text-muted-foreground block text-xs">{text(r.branchName)}</span>}
                  </TableCell>
                  <TableCell>
                    {NOTIFICATION_EVENTS.includes(r.event as never) ? t(`events.names.${r.event as "called"}`) : r.event}
                  </TableCell>
                  <TableCell>
                    {NOTIFICATION_CHANNELS.includes(r.channel as never) ? t(`channels.${r.channel as "sms"}`) : r.channel}
                  </TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {r.recipientMasked ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                      {t(`log.statuses.${r.status}`)}
                    </Badge>
                    {r.attempts > 1 && <span className="text-muted-foreground ms-1 text-xs">×{r.attempts}</span>}
                    {r.error && (
                      <span className="text-muted-foreground block max-w-64 truncate text-xs" title={r.error} dir="auto">
                        {t.has(`log.reasons.${r.error}`) ? t(`log.reasons.${r.error}` as "log.all") : r.error}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {(r.status === "failed" || r.status === "skipped") && r.channel !== "none" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("log.resend")}
                        title={t("log.resend")}
                        disabled={resend.isPending}
                        onClick={() => resend.mutate(r.id)}
                      >
                        <RotateCw className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="outline" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {t("log.more")}
        </Button>
      )}
    </div>
  );
}
