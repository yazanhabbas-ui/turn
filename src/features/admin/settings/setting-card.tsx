import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/** A titled group of related fields inside a section. Two columns on wide screens via `columns`. */
export function SettingCard({
  title,
  description,
  columns = 1,
  className,
  children,
}: {
  title?: string;
  description?: string;
  /** 2 or 3 lays the children out in a grid from the `sm` breakpoint. */
  columns?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("bg-card rounded-xl border shadow-sm", className)}>
      {(title || description) && (
        <header className="border-b px-4 py-3 md:px-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            {description && <InfoTip>{description}</InfoTip>}
          </h3>
        </header>
      )}
      <div
        className={cn(
          "gap-x-5 gap-y-4 p-4 md:p-5",
          columns === 1 && "space-y-4",
          columns > 1 && "grid",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {children}
      </div>
    </section>
  );
}
