"use client";

import { LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Admin navigation. Sections are added here as each milestone ships them. */
const ITEMS = [{ href: "/admin", key: "dashboard", icon: LayoutDashboard, permission: "admin.access" }] as const;

export function AdminSidebar({ permissions }: { permissions: string[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar hidden w-60 shrink-0 border-e p-3 md:block">
      <nav className="space-y-1">
        {ITEMS.filter((i) => permissions.includes(i.permission)).map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "text-sidebar-foreground/80 hover:bg-sidebar-accent flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                active && "bg-brand/10 text-brand",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
