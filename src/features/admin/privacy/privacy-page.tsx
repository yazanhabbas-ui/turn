"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search, UserX } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation } from "@/components/admin/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useText } from "../use-lookups";

const BASE = "/api/v1/admin/privacy";
const REQUESTS = `${BASE}/requests`;

type Subject = {
  id: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  visitCount: number;
  lastVisitAt: string | null;
  anonymizedAt: string | null;
  notificationsOptOut: boolean;
  held: {
    tickets: number;
    ticketsWithData: number;
    appointments: number;
    feedback: number;
    comments: number;
    notifications: number;
  };
};
type RequestRow = {
  id: string;
  type: "access" | "erasure";
  status: string;
  subjectKind: "visitor" | "user";
  subjectRef: string;
  requestedAt: string;
  note: string | null;
  performedBy: Record<string, string> | null;
};
type Download = { filename: string; mime: string; content: string };

function save(file: Download) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Erase({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const erase = useApiMutation(() => api(`${BASE}/subjects/${subject.id}/erase`, { body: { reason, confirm: true } }), {
    success: t("erased"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [REQUESTS] });
      void qc.invalidateQueries({ queryKey: [`${BASE}/subjects`] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("eraseTitle")}</DialogTitle>
          <DialogDescription>{t("eraseBody")}</DialogDescription>
        </DialogHeader>
        <Field label={t("reason")} htmlFor="pr-reason" hint={t("reasonHint")}>
          <Textarea id="pr-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="accent-brand mt-0.5 size-4"
            checked={sure}
            onChange={(e) => setSure(e.target.checked)}
          />
          <span>{t("eraseConfirm")}</span>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!sure || reason.trim().length < 3 || erase.isPending}
            onClick={() => erase.mutate(undefined)}
          >
            {t("erase")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubjectCard({ s }: { s: Subject }) {
  const t = useTranslations("privacy");
  const fmt = useFormatter();
  const qc = useQueryClient();
  const [erasing, setErasing] = useState(false);
  const exportData = useApiMutation(
    (format: "json" | "csv") => api<Download>(`${BASE}/subjects/${s.id}/export`, { body: { format } }),
    {
      success: t("exported"),
      onSuccess: (file) => {
        save(file);
        void qc.invalidateQueries({ queryKey: [REQUESTS] });
      },
    },
  );
  const h = s.held;
  return (
    <article className="bg-card space-y-3 rounded-xl border p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{s.name ?? t("noName")}</h3>
          <p className="text-muted-foreground text-sm" dir="ltr">
            {s.phone ?? t("noPhone")}
          </p>
          {s.company && <p className="text-muted-foreground text-sm">{s.company}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.anonymizedAt && <Badge variant="secondary">{t("anonymized")}</Badge>}
          {s.notificationsOptOut && <Badge variant="outline">{t("optedOut")}</Badge>}
        </div>
      </header>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("visits")}</dt>
          <dd className="tabular-nums">{fmt.number(s.visitCount)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("lastVisit")}</dt>
          <dd>{s.lastVisitAt ? fmt.dateTime(new Date(s.lastVisitAt), { dateStyle: "medium" }) : "-"}</dd>
        </div>
        {(["tickets", "ticketsWithData", "appointments", "feedback", "comments", "notifications"] as const).map((k) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t(`held.${k}`)}</dt>
            <dd className="tabular-nums">{fmt.number(h[k])}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportData.isPending}
          onClick={() => exportData.mutate("json")}
        >
          <Download aria-hidden />
          {t("exportJson")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportData.isPending}
          onClick={() => exportData.mutate("csv")}
        >
          <Download aria-hidden />
          {t("exportCsv")}
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => setErasing(true)}>
          <UserX aria-hidden />
          {t("erase")}
        </Button>
      </div>
      {erasing && <Erase subject={s} onClose={() => setErasing(false)} />}
    </article>
  );
}

function History() {
  const t = useTranslations("privacy");
  const fmt = useFormatter();
  const text = useText();
  const q = useQuery({ queryKey: [REQUESTS], queryFn: () => api<{ items: RequestRow[] }>(REQUESTS) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  const rows = q.data?.items ?? [];
  if (!rows.length) return <EmptyState title={t("historyEmpty")} />;
  return (
    <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("when")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>{t("subject")}</TableHead>
            <TableHead>{t("by")}</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">
                {fmt.dateTime(new Date(r.requestedAt), { dateStyle: "medium", timeStyle: "short" })}
              </TableCell>
              <TableCell>{t(`types.${r.type}`)}</TableCell>
              <TableCell>
                <span className="text-muted-foreground text-xs">{t(`kinds.${r.subjectKind}`)}</span>{" "}
                <code className="text-xs" dir="ltr">
                  {r.subjectRef.slice(0, 10)}
                </code>
              </TableCell>
              <TableCell>{text(r.performedBy, "-")}</TableCell>
              <TableCell className="max-w-64 truncate">{r.note ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={r.status === "completed" ? "secondary" : "destructive"}>{t(`statuses.${r.status}`)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Admin, Privacy requests: find a visitor, show what is held, export it, erase it; and the history of requests. */
export function PrivacyPage() {
  const t = useTranslations("privacy");
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const results = useQuery({
    queryKey: [`${BASE}/subjects`, term],
    queryFn: () => api<{ items: Subject[] }>(`${BASE}/subjects?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  });
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <section className="space-y-3" aria-labelledby="pr-find">
        <h2 id="pr-find" className="text-lg font-semibold">
          {t("find")}
        </h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(input.trim());
          }}
        >
          <Field label={t("findLabel")} htmlFor="pr-q" hint={t("findHint")} className="min-w-64 flex-1">
            <Input id="pr-q" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" disabled={input.trim().length < 2} className="mb-0.5">
            <Search aria-hidden />
            {t("search")}
          </Button>
        </form>
        {term.length >= 2 &&
          (results.isLoading ? (
            <LoadingRows rows={2} />
          ) : results.isError ? (
            <ErrorState onRetry={() => results.refetch()} />
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <EmptyState title={t("noMatch")} />
          ) : (
            <div className="space-y-3">
              {results.data!.items.map((s) => (
                <SubjectCard key={s.id} s={s} />
              ))}
            </div>
          ))}
      </section>
      <section className="space-y-3" aria-labelledby="pr-history">
        <h2 id="pr-history" className="text-lg font-semibold">
          {t("history")}
        </h2>
        <History />
      </section>
    </div>
  );
}
