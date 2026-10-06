"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { SETTINGS_ACTIVE, SETTINGS_GO, type SettingsGoDetail } from "./nav-events";
import { GROUPS, sectionsFor, type SectionId } from "./sections/registry";

const HREF = "/settings";

/**
 * The Settings app's side navigation: every section, grouped. Choosing one opens it on the settings page, through the
 * page's unsaved-edits guard when that page is already open. Phones use the section picker inside the page instead.
 */
export function SettingsSidebar() {
  const ts = useTranslations("settings");
  const ta = useTranslations("admin");
  const pathname = usePathname();
  const onAudit = pathname.startsWith("/settings/audit");
  const router = useRouter();
  const current = useSearchParams().get("section");
  const sections = sectionsFor(true);
  // The open section: told by the settings page itself, else read from the address.
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLive((e as CustomEvent<string>).detail);
    window.addEventListener(SETTINGS_ACTIVE, on);
    return () => window.removeEventListener(SETTINGS_ACTIVE, on);
  }, []);
  const selected = (id: SectionId) => !onAudit && (live ?? current ?? sections[0]?.id) === id;
  // Keep the open section in view when the list is longer than the window.
  useEffect(() => {
    document.querySelector('[data-settings-menu] [aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [live, current]);

  function go(e: React.MouseEvent, id: SectionId) {
    e.preventDefault();
    const detail: SettingsGoDetail = { id };
    window.dispatchEvent(new CustomEvent(SETTINGS_GO, { detail }));
    if (!detail.handled) router.push(`${HREF}?section=${id}`);
  }

  return (
    <aside className="bg-sidebar hidden w-60 shrink-0 border-e p-3 md:block">
      <nav
        data-settings-menu
        className="sticky top-17 max-h-[calc(100dvh-5rem)] space-y-2 overflow-y-auto"
        aria-label={ts("title")}
      >
        {GROUPS.filter((g) => sections.some((s) => s.group === g)).map((g) => (
          <div key={g} role="group" aria-label={ts(`groups.${g}`)}>
            {/* A group title, not a link: bold with a rule after it, and its settings indented below. */}
            <div className="text-foreground mt-2 flex items-center gap-2 px-2 pb-1 text-xs font-bold" aria-hidden>
              <span>{ts(`groups.${g}`)}</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <ul className="ps-2">
              {sections
                .filter((s) => s.group === g)
                .map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`${HREF}?section=${s.id}`}
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
        <div role="group" aria-label={ta("audit")}>
          <div className="bg-border my-2 h-px" aria-hidden />
          <Link
            href="/settings/audit"
            aria-current={onAudit ? "page" : undefined}
            className={cn(
              "text-sidebar-foreground/80 hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium",
              onAudit && "bg-brand/10 text-brand font-semibold",
            )}
          >
            <ScrollText className="size-4" aria-hidden />
            {ta("audit")}
          </Link>
        </div>
      </nav>
    </aside>
  );
}
