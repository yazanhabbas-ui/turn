"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** One tap to stop all messages. Nothing happens until the button is pressed. */
export function StopForm({ token, sig }: { token: string; sig: string }) {
  const t = useTranslations("visitorStatus.stop");
  const stop = useMutation({
    mutationFn: () => api(`/api/v1/public/tickets/${token}/stop`, { method: "POST", body: { s: sig } }),
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      {stop.isSuccess ? (
        <p role="status">{t("done")}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{t("question")}</p>
          <Button className="w-full" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {t("confirm")}
          </Button>
          {stop.isError && (
            <p role="alert" className="text-destructive text-sm">
              {t("failed")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
