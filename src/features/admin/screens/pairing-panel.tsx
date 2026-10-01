"use client";

import { useTranslations } from "next-intl";
import { CopyField } from "@/components/admin/form";
import type { Pairing } from "./types";

/** Big pairing code with instructions for typing it on the TV. */
export function PairingPanel({ pairing, kind = "display" }: { pairing: Pairing; kind?: "display" | "kiosk" }) {
  const t = useTranslations("screens");
  const path = kind === "kiosk" ? "/kiosk" : "/display";
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <div className="space-y-4 text-center">
      <p className="text-muted-foreground text-sm">
        {t(kind === "kiosk" ? "pairing.kioskInstructions" : "pairing.instructions", { url })}
      </p>
      <div
        dir="ltr"
        className="bg-muted rounded-xl border py-6 font-mono text-5xl font-bold tracking-[0.3em] select-all"
        aria-label={t("pairing.code")}
      >
        {pairing.pairingCode}
      </div>
      <p className="text-muted-foreground text-sm">{t("pairing.validity")}</p>
      <div className="text-start">
        <CopyField value={url} label={t("pairing.address")} />
      </div>
    </div>
  );
}
