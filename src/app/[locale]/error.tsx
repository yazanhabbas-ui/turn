"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const STALE_BUNDLE = /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch dynamically/i;

/**
 * Catches client-side exceptions of any page. A very common cause is a browser tab that was opened before the
 * application was updated and still asks for files of the old build; one automatic reload fixes that.
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");

  useEffect(() => {
    const stale = STALE_BUNDLE.test(`${error.name} ${error.message}`);
    try {
      if (stale && sessionStorage.getItem("dor.reloaded") !== "1") {
        sessionStorage.setItem("dor.reloaded", "1");
        window.location.reload();
        return;
      }
      if (!stale) sessionStorage.removeItem("dor.reloaded");
    } catch {
      /* storage unavailable: just show the message */
    }
  }, [error]);

  return (
    <div className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="text-2xl font-bold">{t("somethingWrong")}</h1>
      <p className="text-muted-foreground mt-2">{t("errorBody")}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden />
          {t("reload")}
        </Button>
        <Button variant="outline" onClick={reset}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
