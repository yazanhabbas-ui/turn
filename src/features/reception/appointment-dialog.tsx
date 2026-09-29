"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pickText } from "@/i18n/locales";
import { api, ApiError } from "@/lib/api";
import type { L } from "../queue/types";

export type FoundAppointment = {
  id: string;
  code: string;
  status: string;
  scheduledAt: string;
  reason: { id: string; name: L; color: string; icon: string };
  visitor: { name: string | null; phone: string | null; company: string | null } | null;
  ticketId: string | null;
};

/** Look up a pre-booked appointment by its code; on confirm, the issue panel opens preselected for it. */
export function AppointmentDialog({
  open,
  branchId,
  onClose,
  onFound,
}: {
  open: boolean;
  branchId: string;
  onClose: () => void;
  onFound: (a: FoundAppointment) => void;
}) {
  const t = useTranslations("reception");
  const locale = useLocale();
  const format = useFormatter();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<FoundAppointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFound(null);
    try {
      const a = await api<FoundAppointment>(`/api/v1/queue/appointments?${new URLSearchParams({ branchId, code })}`);
      if (a.status !== "BOOKED") setError(t("alreadyCheckedIn"));
      else setFound(a);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "not_found" ? t("notFound") : String(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setCode("");
          setFound(null);
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("checkIn")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={find} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="appt-code">{t("appointmentCode")}</Label>
            <Input
              id="appt-code"
              dir="ltr"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="tabular h-11 text-lg tracking-widest"
            />
          </div>
          <Button type="submit" className="h-11" disabled={code.trim().length < 3}>
            {t("find")}
          </Button>
        </form>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {found && (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="font-semibold">{pickText(found.reason.name, locale)}</div>
            <div className="text-muted-foreground text-sm">
              {format.dateTime(new Date(found.scheduledAt), { dateStyle: "medium", timeStyle: "short" })}
            </div>
            {found.visitor?.name && <div className="text-sm">{found.visitor.name}</div>}
            <Button className="h-11 w-full" onClick={() => onFound(found)}>
              {t("checkInIssue")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
