"use client";

import {
  BellRing,
  ChevronDown,
  Building2,
  FlaskConical,
  Route,
  KeyRound,
  LayoutDashboard,
  MapPinned,
  ListChecks,
  Monitor,
  ScrollText,
  ShieldCheck,
  Settings,
  UsersRound,
  UserRoundCog,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { SETTINGS_ACTIVE, SETTINGS_GO, type SettingsGoDetail } from "./settings/nav-events";
import { GROUPS, sectionsFor, type SectionId } from "./settings/sections/registry";

/** Admin navigation. Each item is shown only when the user holds its permission. */
const ITEMS = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard, permission: "admin.access" },
  { href: "/admin/users", key: "users", icon: UserRoundCog, permission: "users.view" },
  { href: "/admin/roles", key: "roles", icon: KeyRound, permission: "roles.view" },
  { href: "/admin/cities", key: "cities", icon: MapPinned, permission: "cities.manage" },
  { href: "/admin/branches", key: "branches", icon: Building2, permission: "admin.access" },
  { href: "/admin/reasons", key: "reasons", icon: ListChecks, permission: "reasons.view" },
  { href: "/admin/groups", key: "groups", icon: UsersRound, permission: "reasons.view" },
  { href: "/admin/distribution", key: "distribution", icon: Route, permission: "distribution.manage" },
  { href: "/admin/simulate", key: "simulate", icon: FlaskConical, permission: "distribution.simulate" },
  { href: "/admin/screens", key: "screens", icon: Monitor, permission: "displays.manage" },
  { href: "/admin/notifications", key: "notifications", icon: BellRing, permission: "admin.access" },
  { href: "/admin/settings", key: "settings", icon: Settings, permission: "settings.manage", also: ["branches.manage"] },
  { href: "/admin/privacy", key: "privacy", icon: ShieldCheck, permission: "visitors.privacy" },
  { href: "/admin/audit", key: "audit", icon: ScrollText, permission: "audit.view" },
] as const;

/**
 * "Settings" with its sections as a dropdown list underneath. Choosing a section opens it on the settings page (through
 * the page's unsaved-edits guard when that page is already open).
 */
function SettingsMenu({ item, active, organization }: { item: (typeof ITEMS)[number]; active: boolean; organization: boolean }) {
  const t = useTranslations("admin");
  const ts = useTranslations("settings");
  const router = useRouter();
  const current = useSearchParams().get("section");
  const sections = sectionsFor(organization);
  const [open, setOpen] = useState(active);
  // Arriving on the settings page opens the list; the arrow can still fold it away there.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const shown = open;
  // The open section: told by the settings page itself, else read from the address.
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLive((e as CustomEvent<string>).detail);
    window.addEventListener(SETTINGS_ACTIVE, on);
    return () => window.removeEventListener(SETTINGS_ACTIVE, on);
  }, []);
  const selected = (id: SectionId) => active && (live ?? current ?? sections[0]?.id) === id;
  // Keep the open section in view when the list is longer than the window.
  useEffect(() => {
    if (shown) document.querySelector('[data-settings-menu] [aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [shown, live, current]);

  function go(e: React.MouseEvent, id: SectionId) {
    e.preventDefault();
    const detail: SettingsGoDetail = { id };
    window.dispatchEvent(new CustomEvent(SETTINGS_GO, { detail }));
    if (!detail.handled) router.push(`${item.href}?section=${id}`);
  }

  return (
    <div>
      <div
        className={cn(
          "text-sidebar-foreground/80 hover:bg-sidebar-accent flex items-center rounded-md text-sm font-medium",
          active && "bg-brand/10 text-brand",
        )}
      >
        <Link href={item.href} className="flex flex-1 items-center gap-2.5 py-2 ps-3" onClick={() => setOpen(true)}>
          <item.icon className="size-4" aria-hidden />
          {t(item.key)}
        </Link>
        <button
          type="button"
          aria-expanded={shown}
          aria-label={t(item.key)}
          onClick={() => setOpen(!shown)}
          className="grid size-9 place-items-center rounded-md"
        >
          <ChevronDown className={cn("size-4 transition-transform", !shown && "-rotate-90 rtl:rotate-90")} aria-hidden />
        </button>
      </div>
      {shown && (
        <div data-settings-menu className="border-sidebar-border ms-5 mt-1 space-y-2 border-s ps-2">
          {GROUPS.filter((g) => sections.some((s) => s.group === g)).map((g) => (
            <div key={g}>
              <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide">
                {ts(`groups.${g}`)}
              </div>
              <ul>
                {sections
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`${item.href}?section=${s.id}`}
                        aria-current={selected(s.id) ? "page" : undefined}
                        onClick={(e) => go(e, s.id)}
                        className={cn(
                          "text-sidebar-foreground/80 hover:bg-sidebar-accent block truncate rounded-md px-2 py-1.5 text-[13px]",
                          selected(s.id) && "bg-brand/10 text-brand font-semibold",
                        )}
                      >
                        {ts(`tabs.${s.id}`)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminSidebar({ permissions }: { permissions: string[] }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const items = ITEMS.filter(
    (i) => permissions.includes(i.permission) || ("also" in i && i.also.some((p) => permissions.includes(p))),
  );
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
          {items.map((item) =>
            item.key === "settings" ? (
              <SettingsMenu
                key={item.href}
                item={item}
                active={isActive(item.href)}
                organization={permissions.includes("settings.manage")}
              />
            ) : (
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
            ),
          )}
        </nav>
      </aside>
    </>
  );
}
