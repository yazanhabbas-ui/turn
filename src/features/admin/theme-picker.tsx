"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { DisplayThemeChoice, SurfaceTheme } from "@/domain/branding/surface-theme";
import { cn } from "@/lib/utils";

/**
 * A small waiting-room screen drawn with the display's own theme tokens (`.dor-display[data-theme]`), so the preview
 * can never drift from the real look.
 */
export function ThemePreview({ theme, primary, accent }: { theme: SurfaceTheme; primary: string; accent: string }) {
  return (
    <div
      aria-hidden
      data-theme={theme}
      className="dor-display pointer-events-none flex aspect-video w-full flex-col gap-1 overflow-hidden rounded-md border p-1.5"
      style={{ "--dsp-primary": primary, "--dsp-accent-brand": accent } as React.CSSProperties}
    >
      <div className="flex items-center gap-1">
        <span className="bg-dsp-line h-2.5 w-4 rounded-sm" />
        <span className="bg-dsp-soft/70 h-1 w-8 rounded-full" />
        <span className="bg-dsp-muted/70 ms-auto h-1 w-4 rounded-full" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_1fr] gap-1">
        <div className="flex flex-col gap-0.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-dsp-surface border-dsp-line flex flex-1 items-center justify-between rounded-sm border px-1"
            >
              <span className="bg-dsp-muted/60 h-0.5 w-3 rounded-full" />
              <span className={cn("text-[7px] leading-none font-black", i === 0 ? "text-dsp-hot" : "text-dsp-ok")}>
                A{i + 1}2
              </span>
            </div>
          ))}
        </div>
        <div className="bg-dsp-surface border-dsp-hot-line flex flex-col items-center justify-center rounded-sm border">
          <span className="text-dsp-strong text-[12px] leading-none font-black">A12</span>
          <span className="text-dsp-accent text-[6px] leading-none font-bold">3</span>
        </div>
      </div>
      <div className="bg-dsp-surface border-dsp-line h-1.5 rounded-sm border-t" />
    </div>
  );
}

/**
 * Radio cards for choosing a look: dark, light, brand and (optionally) "use the default". Each card shows a preview.
 * `defaultTheme` is what "use the default" resolves to right now.
 */
export function ThemePicker({
  value,
  onChange,
  legend,
  primary,
  accent,
  withDefault,
  defaultTheme = "dark",
}: {
  value: DisplayThemeChoice;
  onChange: (v: DisplayThemeChoice) => void;
  legend: string;
  primary: string;
  accent: string;
  withDefault?: boolean;
  defaultTheme?: SurfaceTheme;
}) {
  const t = useTranslations("themePicker");
  const name = useId();
  const choices: DisplayThemeChoice[] = withDefault ? ["default", "dark", "light", "brand"] : ["dark", "light", "brand"];
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className={cn("grid grid-cols-2 gap-2", withDefault ? "sm:grid-cols-4" : "sm:grid-cols-3")} role="radiogroup">
        {choices.map((c) => (
          <label
            key={c}
            className={cn(
              "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2 text-sm has-[:focus-visible]:ring-2",
              value === c ? "border-brand bg-brand/5" : "hover:bg-muted/50",
            )}
          >
            <ThemePreview theme={c === "default" ? defaultTheme : c} primary={primary} accent={accent} />
            <span className="flex items-center gap-2 font-medium">
              <input type="radio" name={name} className="accent-brand" checked={value === c} onChange={() => onChange(c)} />
              {t(c)}
            </span>
            {c === "default" && (
              <span className="text-muted-foreground text-xs">{t("defaultNow", { theme: t(defaultTheme) })}</span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
