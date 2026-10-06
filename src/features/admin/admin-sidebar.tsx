"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_ITEMS as ITEMS } from "./admin-nav";

export function AdminSidebar({ permissions }: { permissions: string[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const items = ITEMS.filter((i) => permissions.includes(i.permission));
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <>
      {/* Phones and small tablets: horizontal scrolling nav under the header. */}
      <nav
        className="bg-sidebar sticky top-14 z-20 flex gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden"
        aria-label={t("dashboard")}
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
              isActive(item.href) ? "bg-brand/10 text-brand" : "text-sidebar-foreground/80",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {t(item.key)}
          </Link>
        ))}
      </nav>
      <aside className="bg-sidebar hidden w-60 shrink-0 border-e p-3 md:block">
        <nav className="sticky top-17 max-h-[calc(100dvh-5rem)] space-y-1 overflow-y-auto">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "text-sidebar-foreground/80 hover:bg-sidebar-accent flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                isActive(item.href) && "bg-brand/10 text-brand",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
