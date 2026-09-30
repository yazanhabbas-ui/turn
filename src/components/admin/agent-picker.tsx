"use client";

import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildIndex, filterAndRank, type SearchIndex } from "@/lib/picker-search";
import { cn } from "@/lib/utils";

/** One selectable person. `label` is the name in the current language; `altLabels` the other languages. */
export type PickerOption = {
  id: string;
  label: string;
  altLabels?: string[];
  email?: string | null;
  phone?: string | null;
  /** Employee number or any other code people search by. */
  code?: string | null;
  branch?: string | null;
  desk?: string | null;
  /** Small second line (role, branch, status text). Defaults to the branch. */
  subtitle?: string | null;
  /** AVAILABLE | BUSY | ON_BREAK | AWAY | OFFLINE, when known. */
  status?: string | null;
  /** Translated status, used as the tooltip and for screen readers. */
  statusLabel?: string | null;
  imageUrl?: string | null;
};

type Common = {
  options: PickerOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Hidden from the list (already used elsewhere). A currently selected person stays visible. */
  excludeIds?: string[];
  id?: string;
  className?: string;
  /** Group the list by branch when the options span several (default true). */
  groupByBranch?: boolean;
  /** Most rows rendered at once; the rest is reached by typing (default 50). */
  maxRows?: number;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export type AgentPickerProps = Common & {
  /** Selected id, "" for none. */
  value: string;
  onChange: (id: string) => void;
  /** Show a clear button while something is selected (default true). */
  clearable?: boolean;
};

export type AgentMultiPickerProps = Common & {
  value: string[];
  onChange: (ids: string[]) => void;
};

const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-emerald-500",
  BUSY: "bg-blue-500",
  ON_BREAK: "bg-amber-500",
  AWAY: "bg-slate-400",
  OFFLINE: "bg-slate-300",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function Avatar({ o, size = "md" }: { o: PickerOption; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-5 text-[9px]" : "size-7 text-[11px]";
  return (
    <span className={cn("relative inline-flex shrink-0", dim)}>
      {o.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.imageUrl} alt="" className={cn("rounded-full object-cover", dim)} />
      ) : (
        <span
          aria-hidden
          className={cn("bg-muted text-muted-foreground inline-flex items-center justify-center rounded-full font-medium", dim)}
        >
          {initials(o.label)}
        </span>
      )}
      {o.status && (
        <span
          role="img"
          aria-label={o.statusLabel ?? o.status}
          title={o.statusLabel ?? o.status}
          className={cn(
            "ring-background absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2",
            STATUS_DOT[o.status] ?? "bg-slate-300",
          )}
        />
      )}
    </span>
  );
}

function Row({ o }: { o: PickerOption }) {
  const sub = o.subtitle ?? [o.branch, o.desk].filter(Boolean).join(" · ");
  return (
    <>
      <Avatar o={o} />
      <span className="min-w-0 flex-1 text-start">
        <span className="block truncate text-sm">{o.label}</span>
        {(sub || o.statusLabel) && (
          <span className="text-muted-foreground block truncate text-xs">{[sub, o.statusLabel].filter(Boolean).join(" · ")}</span>
        )}
      </span>
    </>
  );
}

function indexOf(o: PickerOption): SearchIndex {
  return buildIndex({
    names: [o.label, ...(o.altLabels ?? [])],
    ids: [o.email, o.phone, o.code].filter(Boolean) as string[],
    context: [o.branch, o.desk, o.subtitle].filter(Boolean) as string[],
  });
}

type Base = Common & {
  multiple: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  clearable: boolean;
};

function PickerBase(p: Base) {
  const t = useTranslations("picker");
  const uid = useId();
  const listId = `${uid}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const maxRows = p.maxRows ?? 50;

  const indexed = useMemo(() => p.options.map((o) => ({ o, ix: indexOf(o) })), [p.options]);
  const byId = useMemo(() => new Map(p.options.map((o) => [o.id, o])), [p.options]);
  const exclude = useMemo(() => new Set(p.excludeIds ?? []), [p.excludeIds]);
  const selectedSet = useMemo(() => new Set(p.selected), [p.selected]);

  const ranked = useMemo(() => {
    const pool = indexed.filter((x) => !exclude.has(x.o.id) || selectedSet.has(x.o.id));
    const ixOf = new Map(pool.map((x) => [x.o, x.ix]));
    return filterAndRank(
      pool.map((x) => x.o),
      query,
      (o) => ixOf.get(o)!,
    );
  }, [indexed, exclude, selectedSet, query]);

  const shown = ranked.slice(0, maxRows);
  const more = ranked.length - shown.length;
  const branches = useMemo(() => new Set(shown.map((o) => o.branch ?? "")), [shown]);
  const grouped = (p.groupByBranch ?? true) && branches.size > 1 && !query.trim();
  // With grouping the visible order is grouped by branch, so keyboard navigation follows what is drawn.
  const flat = useMemo(() => {
    if (!grouped) return shown;
    const order: string[] = [];
    const map = new Map<string, PickerOption[]>();
    for (const o of shown) {
      const k = o.branch ?? "";
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)!.push(o);
    }
    return order.flatMap((k) => map.get(k)!);
  }, [shown, grouped]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-o${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, uid]);

  const pick = (o: PickerOption) => {
    p.onToggle(o.id);
    if (!p.multiple) close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 8));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 8));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = flat[active];
      if (o) pick(o);
    } else if (e.key === "Escape") {
      // Closes the list only, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "Backspace" && p.multiple && !query && p.selected.length) {
      p.onToggle(p.selected[p.selected.length - 1]);
    }
  };

  const single = !p.multiple ? byId.get(p.selected[0] ?? "") : undefined;
  const chips = p.multiple ? p.selected.map((id) => byId.get(id)).filter((o): o is PickerOption => !!o) : [];
  const activeId = flat[active] ? `${uid}-o${active}` : undefined;

  let lastGroup: string | null = null;
  return (
    <div ref={rootRef} className={cn("relative w-full", p.className)}>
      {p.multiple && chips.length > 0 && (
        <ul className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label={t("selected", { count: chips.length })}>
          {chips.map((o) => (
            <li key={o.id} className="bg-muted flex max-w-full items-center gap-1.5 rounded-full py-0.5 ps-1 pe-1 text-sm">
              <Avatar o={o} size="sm" />
              <span className="truncate">{o.label}</span>
              <button
                type="button"
                disabled={p.disabled}
                className="text-muted-foreground hover:text-foreground hover:bg-background focus-visible:ring-ring inline-flex size-5 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-50"
                aria-label={t("remove", { name: o.label })}
                onClick={() => p.onToggle(o.id)}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        ref={triggerRef}
        type="button"
        id={p.id}
        disabled={p.disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={p["aria-label"]}
        aria-labelledby={p["aria-labelledby"]}
        aria-describedby={p["aria-describedby"]}
        aria-invalid={p["aria-invalid"]}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "border-input bg-background flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-start text-sm shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive",
          !p.multiple && single && p.clearable && "pe-14",
          !p.multiple && !(single && p.clearable) && "pe-8",
          p.multiple && "pe-8",
        )}
      >
        {single ? (
          <Row o={single} />
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.placeholder ?? t("placeholder")}</span>
        )}
        <ChevronsUpDown className="text-muted-foreground pointer-events-none absolute end-2.5 size-4 shrink-0" aria-hidden />
      </button>
      {!p.multiple && single && p.clearable && !p.disabled && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute end-8 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          aria-label={t("clear")}
          onClick={() => {
            p.onClear();
            triggerRef.current?.focus();
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {p.multiple && chips.length > 1 && !p.disabled && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-1 text-xs underline-offset-2 hover:underline"
          onClick={p.onClear}
        >
          {t("clearAll")}
        </button>
      )}

      {open && (
        <div className="bg-popover text-popover-foreground absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border shadow-md">
          <div className="relative border-b">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={t("search")}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-9 w-full bg-transparent ps-8 pe-3 text-sm outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-multiselectable={p.multiple || undefined} className="max-h-64 overflow-y-auto p-1">
            {flat.length === 0 && (
              <li role="presentation" className="text-muted-foreground px-3 py-6 text-center text-sm">
                {t("noResults")}
              </li>
            )}
            {flat.map((o, i) => {
              const header = grouped && (o.branch ?? "") !== lastGroup ? (o.branch ?? "") : null;
              if (grouped) lastGroup = o.branch ?? "";
              const isSel = selectedSet.has(o.id);
              return (
                <li key={o.id} role="presentation">
                  {header !== null && header !== "" && (
                    <div role="presentation" className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                      {header}
                    </div>
                  )}
                  <div
                    id={`${uid}-o${i}`}
                    role="option"
                    aria-selected={isSel}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                      i === active && "bg-accent text-accent-foreground",
                    )}
                    onPointerMove={() => i !== active && setActive(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    <Row o={o} />
                    {isSel && <Check className="size-4 shrink-0" aria-hidden />}
                  </div>
                </li>
              );
            })}
            {more > 0 && (
              <li role="presentation" className="text-muted-foreground px-3 py-2 text-center text-xs">
                {t("more", { count: more })}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Searchable single-select for a person (agent, user). Value "" means none. */
export function AgentPicker({ value, onChange, clearable = true, ...rest }: AgentPickerProps) {
  return (
    <PickerBase
      {...rest}
      multiple={false}
      selected={value ? [value] : []}
      onToggle={(id) => onChange(id)}
      onClear={() => onChange("")}
      clearable={clearable}
    />
  );
}

/** Searchable multi-select; the selection shows as removable chips. */
export function AgentMultiPicker({ value, onChange, ...rest }: AgentMultiPickerProps) {
  return (
    <PickerBase
      {...rest}
      multiple
      selected={value}
      onToggle={(id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])}
      onClear={() => onChange([])}
      clearable
    />
  );
}
