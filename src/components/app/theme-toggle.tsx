"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const subscribe = () => () => undefined;
/** True only after hydration, so the icon never disagrees with the server markup. */
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/** Keeps the browser chrome colour (`theme-color`) in step with the active theme. */
function useThemeColorMeta(resolved: string | undefined) {
  useEffect(() => {
    if (!resolved) return;
    const color = resolved === "dark" ? "#0a0a0a" : "#0f766e";
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const m = document.createElement("meta");
      m.name = "theme-color";
      m.content = color;
      document.head.appendChild(m);
      return;
    }
    metas.forEach((m) => {
      m.removeAttribute("media");
      m.content = color;
    });
  }, [resolved]);
}

/** Light / dark switch for the staff application; the first visit follows the system preference. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  useThemeColorMeta(mounted ? resolvedTheme : undefined);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("toLight") : t("toDark");

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={mounted ? label : t("label")}
      title={mounted ? label : t("label")}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {mounted ? dark ? <Sun aria-hidden /> : <Moon aria-hidden /> : <span className="size-4" aria-hidden />}
    </Button>
  );
}
