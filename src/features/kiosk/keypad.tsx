"use client";

import { Delete } from "lucide-react";
import { KEYPAD_LAYOUT, type KeypadKey } from "@/domain/kiosk/keypad";
import { applyDigits, type DigitSystem } from "@/domain/i18n/digits";
import { cn } from "@/lib/utils";
import type { T } from "../display/text";

/** Big numeric keypad for the phone number. Keys are at least 72 px tall; digits follow the screen digit setting. */
export function Keypad({ digits, t, onKey }: { digits: DigitSystem; t: T; onKey: (key: KeypadKey) => void }) {
  return (
    <div dir="ltr" className="grid grid-cols-3 gap-3" role="group" aria-label={t("keypad")}>
      {KEYPAD_LAYOUT.map((k) => {
        const action = k === "clear" || k === "back";
        return (
          <button
            key={k}
            type="button"
            onClick={() => onKey(k)}
            aria-label={k === "clear" ? t("clear") : k === "back" ? t("delete") : undefined}
            className={cn(
              "tabular grid min-h-[4.5rem] place-items-center rounded-2xl border-2 text-4xl font-semibold shadow-sm transition select-none active:scale-95",
              action ? "bg-muted text-muted-foreground text-xl" : "bg-card hover:border-brand/50",
            )}
          >
            {k === "back" ? <Delete className="size-8" aria-hidden /> : k === "clear" ? t("clear") : applyDigits(k, digits)}
          </button>
        );
      })}
    </div>
  );
}
