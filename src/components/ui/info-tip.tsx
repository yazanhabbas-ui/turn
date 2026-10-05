"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * A small (?) button that reveals explanatory text on hover, focus or tap. Use it instead of printing a hint under a
 * metric, field or feature, so the explanation is there when wanted and the screen stays clean.
 */
export function InfoTip({ children, className }: { children: React.ReactNode; className?: string }) {
  const t = useTranslations("common");
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        type="button"
        aria-label={t("moreInfo")}
        // Inside a <label> a click would toggle the control; keep it from doing so.
        onClick={(e) => e.preventDefault()}
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 relative inline-flex size-4 after:absolute after:-inset-2.5 after:content-[''] shrink-0 items-center justify-center rounded-full align-middle outline-none focus-visible:ring-3",
          className,
        )}
      >
        <CircleHelp className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={8} className="isolate z-50">
          <Popover.Popup className="bg-popover text-popover-foreground ring-foreground/10 max-w-[min(18rem,calc(100vw-1rem))] rounded-lg px-3 py-2 text-xs leading-relaxed shadow-md ring-1">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
