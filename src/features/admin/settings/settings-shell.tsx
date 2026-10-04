"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingsShellContext, type SettingsShellApi } from "./settings-context";
import { SETTINGS_ACTIVE, SETTINGS_GO, type SettingsGoDetail } from "./nav-events";
import { searchSettings } from "./settings-search";
import { GROUPS, type SectionDef, type SectionId } from "./sections/registry";

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName));
};

/**
 * Two-column settings layout: grouped navigation with search on the start side (a select on phones), and the active
 * section on the other. The section lives in `?section=`, unsaved edits are guarded when leaving a section.
 */
export function SettingsShell({
  sections,
  render,
  meta,
  topBar,
}: {
  sections: SectionDef[];
  render: (id: SectionId) => React.ReactNode;
  /** The "Applies to" badge text for a section (its level, or where its value comes from at the chosen scope). */
  meta: (section: SectionDef) => string;
  /** Rendered above the navigation, inside the shell (so it can use the unsaved-edits guard). */
  topBar?: React.ReactNode;
}) {
  const t = useTranslations("settings");
  const params = useSearchParams();
  const requested = params.get("section");
  const valid = (id: string | null): id is SectionId => !!id && sections.some((s) => s.id === id);
  const [active, setActive] = useState<SectionId>(valid(requested) ? requested : sections[0]!.id);
  const [target, setTarget] = useState<{ anchor: string; n: number } | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirty = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);
  // Back/forward or a link changing ?section= after the first render.
  useEffect(() => {
    if (valid(requested)) setActive(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const shell = useMemo<SettingsShellApi>(
    () => ({
      setDirty: (id, isDirty) => {
        if (isDirty) dirty.current.add(id);
        else dirty.current.delete(id);
      },
      guard: (run) => (dirty.current.size ? setPending(() => run) : run()),
    }),
    [],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (id: SectionId, anchor?: string) => {
      const run = () => {
        setActive(id);
        setTarget(anchor ? { anchor, n: Date.now() } : null);
        setQuery("");
        const url = new URL(window.location.href);
        url.searchParams.set("section", id);
        window.history.replaceState(window.history.state, "", url);
        if (!anchor) window.scrollTo({ top: 0 });
      };
      if (id === active) run();
      else shell.guard(run);
    },
    [active, shell],
  );

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<string>(SETTINGS_ACTIVE, { detail: active }));
  }, [active]);

  // The admin sidebar lists the sections under "Settings" and asks this page to open one (through the edits guard).
  useEffect(() => {
    const onGo = (e: Event) => {
      const detail = (e as CustomEvent<SettingsGoDetail>).detail;
      if (!detail || !valid(detail.id)) return;
      detail.handled = true;
      go(detail.id);
    };
    window.addEventListener(SETTINGS_GO, onGo);
    return () => window.removeEventListener(SETTINGS_GO, onGo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, sections]);

  // Scroll to and flash the field chosen in the search results, once its section has rendered.
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const el = document.getElementById(target.anchor);
      if (el) {
        const box = el.closest("[data-field], fieldset, section") ?? el;
        box.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
        if (!reduce) {
          box.animate(
            [
              {
                boxShadow: "0 0 0 4px color-mix(in oklab, var(--color-brand, #2563eb) 45%, transparent)",
                backgroundColor: "color-mix(in oklab, var(--color-brand, #2563eb) 12%, transparent)",
              },
              { boxShadow: "0 0 0 4px transparent", backgroundColor: "transparent" },
            ],
            { duration: 2000, easing: "ease-out" },
          );
        }
      } else if (tries++ < 20) timer = setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(timer);
  }, [target]);

  const hits = useMemo(() => searchSettings(query, sections), [query, sections]);
  const current = sections.find((s) => s.id === active) ?? sections[0]!;
  const Icon = current.icon;
  const searching = query.trim().length > 0;
  const title = (id: SectionId) => t(`tabs.${id}`);

  return (
    <SettingsShellContext.Provider value={shell}>
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t("title")} description={t("description")} />
        {topBar}
        <div className="relative mb-5 max-w-md">
          <Search
            className="text-muted-foreground pointer-events-none absolute inset-s-2.5 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="text"
            role="searchbox"
            value={query}
            placeholder={t("ui.search")}
            aria-label={t("ui.search")}
            className="ps-8 pe-14 max-lg:h-10"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                go(hits[0].section.id, hits[0].fields[0]?.anchor);
              }
            }}
          />
          {searching ? (
            <button
              type="button"
              aria-label={t("ui.clearSearch")}
              className="text-muted-foreground hover:text-foreground absolute inset-e-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            <kbd
              className="text-muted-foreground bg-muted pointer-events-none absolute inset-e-2 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 text-[11px] lg:block"
              dir="ltr"
            >
              /
            </kbd>
          )}
          {searching && (
            <div aria-live="polite" className="absolute inset-x-0 top-full z-30 mt-1">
              {hits.length === 0 ? (
                <p className="bg-card text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm shadow-md">
                  {t("ui.noResults", { query })}
                </p>
              ) : (
                <ul className="bg-card max-h-[70dvh] space-y-1 overflow-y-auto rounded-xl border p-1.5 shadow-lg">
                  {hits.map(({ section, fields }) => {
                    const HitIcon = section.icon;
                    return (
                      <li key={section.id}>
                        <button
                          type="button"
                          className="hover:bg-muted flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-start text-sm font-medium"
                          onClick={() => go(section.id)}
                        >
                          <HitIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                          {title(section.id)}
                        </button>
                        {fields.slice(0, 5).map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-9 w-full items-center rounded-lg ps-9 pe-2.5 text-start text-sm"
                            onClick={() => go(section.id, f.anchor)}
                          >
                            {t(f.key)}
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Phones: the sidebar's section list is not available, so the sections are picked here. */}
        <div className="mb-4 md:hidden">
          <NativeSelect
            aria-label={t("ui.sectionPicker")}
            className="h-10"
            value={active}
            onChange={(e) => go(e.target.value as SectionId)}
          >
            {GROUPS.filter((g) => sections.some((s) => s.group === g)).map((g) => (
              <optgroup key={g} label={t(`groups.${g}`)}>
                {sections
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {title(s.id)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>

        <div className="max-w-4xl min-w-0 max-lg:[&_input:not([type=checkbox]):not([type=radio]):not([type=file])]:h-10 max-lg:[&_select]:h-10">
          <header className="mb-4 flex items-start gap-3">
            <span className="bg-brand/10 text-brand grid size-10 shrink-0 place-items-center rounded-xl">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg leading-tight font-bold">{title(current.id)}</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">{t(`sectionDescriptions.${current.id}`)}</p>
              {meta(current) && (
                <Badge variant="outline" className="mt-2">
                  {t("ui.appliesTo")}: {meta(current)}
                </Badge>
              )}
            </div>
          </header>
          <div key={active} className="space-y-4">
            {render(active)}
          </div>
        </div>
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ui.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("ui.leaveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t("ui.keepEditing")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const run = pending;
                dirty.current.clear();
                setPending(null);
                run?.();
              }}
            >
              {t("ui.leaveDiscard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsShellContext.Provider>
  );
}
