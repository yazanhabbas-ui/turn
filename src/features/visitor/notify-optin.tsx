"use client";

import { useMutation } from "@tanstack/react-query";
import { BellPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** Optional block on the status page: a visitor who gave no phone at reception can ask for updates on theirs. */
export function NotifyOptIn({ token }: { token: string }) {
  const t = useTranslations("visitorStatus.updates");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const save = useMutation({
    mutationFn: () => api(`/api/v1/public/tickets/${token}/contact`, { method: "POST", body: { phone, consent: true } }),
  });
  if (save.isSuccess)
    return (
      <p role="status" className="bg-card mt-6 w-full max-w-sm rounded-2xl border p-4 text-sm shadow-sm">
        {t("done")}
      </p>
    );
  const invalid = save.error instanceof ApiError && save.error.code === "validation";
  return (
    <form
      className="bg-card mt-6 w-full max-w-sm space-y-3 rounded-2xl border p-4 text-start shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (agree && phone.trim() && !save.isPending) save.mutate();
      }}
    >
      <p className="flex items-center gap-2 font-medium">
        <BellPlus className="text-brand size-5" aria-hidden />
        {t("title")}
      </p>
      <label className="block space-y-1 text-sm">
        <span>{t("phone")}</span>
        <Input dir="ltr" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="accent-brand mt-0.5 size-4"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
        />
        <span>{t("consent")}</span>
      </label>
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          {invalid ? t("invalid") : t("failed")}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={!agree || !phone.trim() || save.isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}
