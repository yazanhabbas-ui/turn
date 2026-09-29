"use client";

import {
  Building2,
  FlaskConical,
  Route,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Monitor,
  ScrollText,
  Settings,
  UsersRound,
  UserRoundCog,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Admin navigation. Each item is shown only when the user holds its permission. */
const ITEMS = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard, permission: "admin.access" },
  { href: "/admin/users", key: "users", icon: UserRoundCog, permission: "users.view" },
  { href: "/admin/roles", key: "roles", icon: KeyRound, permission: "roles.view" },
  { href: "/admin/branches", key: "branches", icon: Building2, permission: "admin.access" },
  { href: "/admin/reasons", key: "reasons", icon: ListChecks, permission: "reasons.view" },
  { href: "/admin/groups", key: "groups", icon: UsersRound, permission: "reasons.view" },
  { href: "/admin/distribution", key: "distribution", icon: Route, permission: "distribution.manage" },
  { href: "/admin/simulate", key: "simulate", icon: FlaskConical, permission: "distribution.simulate" },
  { href: "/admin/screens", key: "screens", icon: Monitor, permission: "displays.manage" },
  { href: "/admin/settings", key: "settings", icon: Settings, permission: "settings.manage" },
  { href: "/admin/audit", key: "audit", icon: ScrollText, permission: "audit.view" },
] as const;

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
        <nav className="sticky top-17 space-y-1">
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
