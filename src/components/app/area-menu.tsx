"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The workspace switcher for phones: one button with the current workspace and a list of the others, instead of a row of
 * links that does not fit next to the logo, the language and the account. Wide screens use the row of links.
 */
export function AreaMenu({
  areas,
  current,
  label,
  className,
}: {
  areas: { key: string; href: string; label: string }[];
  current?: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const here = areas.find((a) => a.key === current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="sm" aria-label={label} className={cn("max-w-36 min-w-0", className)} />}
      >
        <span className="truncate">{here?.label ?? label}</span>
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {areas.map((a) => (
          <DropdownMenuItem
            key={a.key}
            onClick={() => router.push(a.href)}
            className={cn(a.key === current && "bg-brand/10 text-brand font-semibold")}
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
