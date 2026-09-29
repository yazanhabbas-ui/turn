import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Styled native <select>. Preferred for forms: works everywhere (tablets, kiosks, screen readers),
 * follows RTL automatically, and has no popup positioning issues.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-background h-9 w-full min-w-0 rounded-lg border px-2.5 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
