"use client";

import { Download, FileSpreadsheet, FileText, Loader2, Table2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check } from "@/features/admin/screens/check";
import { EXPORT_PRESETS, EXPORT_SECTIONS, type ExportSectionId } from "@/domain/reports/sections";
import { cn } from "@/lib/utils";

type Format = "xlsx" | "csv" | "pdf";
const FORMATS: { format: Format; icon: typeof FileText }[] = [
  { format: "xlsx", icon: FileSpreadsheet },
  { format: "csv", icon: Table2 },
  { format: "pdf", icon: FileText },
];
const FORMAT_KEY = "dor.reports.exportFormat";

function readFormat(): Format {
  try {
    const v = window.localStorage.getItem(FORMAT_KEY);
    if (v === "xlsx" || v === "csv" || v === "pdf") return v;
  } catch {
    /* storage unavailable: use the default */
  }
  return "xlsx";
}

function rememberFormat(format: Format) {
  try {
    window.localStorage.setItem(FORMAT_KEY, format);
  } catch {
    /* ignore */
  }
}

/** Downloads the report for the current filter `query` (no "?"), limited to `sections` (null = everything). */
function useDownload(query: string) {
  const t = useTranslations("reportSchedules.exportMenu");
  const locale = useLocale() === "en" ? "en" : "ar";
  const [busy, setBusy] = useState(false);

  async function download(format: Format, sections: readonly ExportSectionId[] | null) {
    setBusy(true);
    try {
      const part = sections ? `&sections=${sections.join(",")}` : "";
      const res = await fetch(`/api/v1/reports/export?format=${format}&locale=${locale}${part}&${query}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(String(res.status));
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `dor-report.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      toast.error(t("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { download, busy };
}

/**
 * The "Download" button of the reports page: opens a dialog to pick the file type and the sections to include.
 * `query` is the current filter query string, the same one the overview request uses; `emptySections` are sections
 * with no data in the period (still downloadable, marked).
 */
export function ExportMenu({ query, emptySections = [] }: { query: string; emptySections?: readonly ExportSectionId[] }) {
  const t = useTranslations("reportSchedules.exportMenu");
  const ts = useTranslations("reportExport.sections");
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("xlsx");
  const [chosen, setChosen] = useState<Set<ExportSectionId>>(() => new Set(EXPORT_SECTIONS));
  const { download, busy } = useDownload(query);
  const empty = new Set(emptySections);

  const toggle = (id: ExportSectionId, on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const list = EXPORT_SECTIONS.filter((id) => chosen.has(id));

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setFormat(readFormat());
          setOpen(true);
        }}
      >
        <Download aria-hidden />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t("format")}</legend>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map(({ format: f, icon: Icon }) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition",
                      format === f ? "border-brand bg-brand/10 text-brand font-medium" : "hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {t(f)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t("presetsLabel")}</legend>
              <div className="flex flex-wrap gap-2">
                {EXPORT_PRESETS.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="outline" onClick={() => setChosen(new Set(p.sections))}>
                    {t(`presets.${p.id}` as "presets.overview")}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">{t("sections")}</legend>
                <div className="flex gap-1">
                  <Button type="button" size="xs" variant="ghost" onClick={() => setChosen(new Set(EXPORT_SECTIONS))}>
                    {t("selectAll")}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setChosen(new Set())}>
                    {t("selectNone")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXPORT_SECTIONS.map((id) => (
                  <Check
                    key={id}
                    label={ts(id)}
                    hint={empty.has(id) ? t("empty") : undefined}
                    checked={chosen.has(id)}
                    onChange={(on) => toggle(id, on)}
                  />
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {t("selected", { count: list.length, total: EXPORT_SECTIONS.length })}
              </p>
            </fieldset>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={busy || list.length === 0}
              onClick={async () => {
                rememberFormat(format);
                if (await download(format, list.length === EXPORT_SECTIONS.length ? null : list)) setOpen(false);
              }}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              {t("download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Small icon button in a report card header: downloads just `sections` with the current filters, in the format last
 * used in the download dialog. Hidden when printing.
 */
export function SectionDownload({
  query,
  sections,
  label,
  empty,
}: {
  query: string;
  sections: readonly ExportSectionId[];
  label: string;
  empty?: boolean;
}) {
  const t = useTranslations("reportSchedules.exportMenu");
  const { download, busy } = useDownload(query);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="no-print text-muted-foreground shrink-0"
      disabled={busy}
      aria-label={t("downloadSection", { section: label })}
      title={empty ? `${t("downloadSection", { section: label })} (${t("empty")})` : t("downloadSection", { section: label })}
      onClick={() => void download(readFormat(), sections)}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
    </Button>
  );
}
