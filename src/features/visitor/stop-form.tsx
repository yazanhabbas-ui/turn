"use client";

import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { TextOverrides } from "@/domain/pagecontent/text";
import { api } from "@/lib/api";
import { PageTextProvider, usePageText } from "../pagecontent/page-text";

/** One tap to stop all messages. Nothing happens until the button is pressed. */
export function StopForm({ token, sig, texts }: { token: string; sig: string; texts?: TextOverrides }) {
  return (
    <PageTextProvider group="visitor" texts={texts}>
      <StopFormBody token={token} sig={sig} />
    </PageTextProvider>
  );
}

function StopFormBody({ token, sig }: { token: string; sig: string }) {
  const t = usePageText("visitor");
  const stop = useMutation({
    mutationFn: () => api(`/api/v1/public/tickets/${token}/stop`, { method: "POST", body: { s: sig } }),
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-xl font-bold">{t("stop.title")}</h1>
      {stop.isSuccess ? (
        <p role="status">{t("stop.done")}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{t("stop.question")}</p>
          <Button className="w-full" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {t("stop.confirm")}
          </Button>
          {stop.isError && (
            <p role="alert" className="text-destructive text-sm">
              {t("stop.failed")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
