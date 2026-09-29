"use client";

import { Download, FileSpreadsheet, FileText, Loader2, Table2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Format = "xlsx" | "csv" | "pdf";
const FORMATS: { format: Format; icon: typeof FileText }[] = [
  { format: "xlsx", icon: FileSpreadsheet },
  { format: "csv", icon: Table2 },
  { format: "pdf", icon: FileText },
];

/**
 * Download the report being viewed as Excel, CSV or PDF, in the interface language. `query` is the current filter
 * query string (without "?"), the same one the overview request uses.
 */
export function ExportMenu({ query }: { query: string }) {
  const t = useTranslations("reportSchedules.exportMenu");
  const locale = useLocale() === "en" ? "en" : "ar";
  const [busy, setBusy] = useState(false);

  async function download(format: Format) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/reports/export?format=${format}&locale=${locale}&${query}`, {
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
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={busy} />}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        {t("button")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map(({ format, icon: Icon }) => (
          <DropdownMenuItem key={format} onClick={() => void download(format)}>
            <Icon aria-hidden />
            {t(format)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
