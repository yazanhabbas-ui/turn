"use client";

import { RotateCcw, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { catalogOf, SCREENS, type CatalogEntry, type PageGroup } from "@/domain/pagecontent/catalog";
import { defaultText } from "@/domain/pagecontent/defaults";
import { textIssue, type TextOverrides } from "@/domain/pagecontent/text";
import { LOCALES } from "@/i18n/locales";
import { buildIndex, scoreMatch } from "@/lib/picker-search";
import { cn } from "@/lib/utils";

type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];

const isModified = (texts: TextOverrides, id: string) => !!(texts[id]?.ar?.trim() || texts[id]?.en?.trim());

/** Sets one language of one text; a text with nothing left in either language is removed (= the default applies). */
export function setText(texts: TextOverrides, id: string, lang: Lang, value: string): TextOverrides {
  const next: TextOverrides = { ...texts, [id]: { ...texts[id], [lang]: value } };
  if (!next[id]!.ar?.trim() && !next[id]!.en?.trim()) delete next[id];
  return next;
}

/**
 * Searchable list of the texts of a page: per text its label and where it appears, an Arabic and an English input that
 * show the default as a placeholder, the placeholders it may use, a character counter and "reset to default".
 * Only changed texts are stored, so a text left alone follows later improvements of the default wording.
 */
export function TextsEditor({
  group,
  texts,
  onChange,
  onFocusEntry,
}: {
  group: PageGroup;
  texts: TextOverrides;
  onChange: (next: TextOverrides) => void;
  onFocusEntry: (entry: CatalogEntry) => void;
}) {
  const t = useTranslations("settings");
  const locale = useLocale() as Lang;
  const [query, setQuery] = useState("");
  const [onlyModified, setOnlyModified] = useState(false);
  const entries = useMemo(() => catalogOf(group), [group]);
  const modifiedCount = entries.filter((e) => isModified(texts, e.id)).length;

  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (onlyModified && !isModified(texts, e.id)) return false;
        return (
          scoreMatch(
            buildIndex({
              names: [e.label.ar, e.label.en],
              ids: [e.id],
              context: [
                e.hint.ar,
                e.hint.en,
                defaultText(e, "ar"),
                defaultText(e, "en"),
                texts[e.id]?.ar ?? "",
                texts[e.id]?.en ?? "",
              ],
            }),
            query,
          ) > 0
        );
      }),
    [entries, onlyModified, query, texts],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("pcSearch")}
            aria-label={t("pcSearch")}
            className="ps-9"
          />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-brand size-4"
            checked={onlyModified}
            onChange={(e) => setOnlyModified(e.target.checked)}
          />
          {t("pcOnlyModified")}
        </label>
        <span className="text-muted-foreground text-xs" aria-live="polite">
          {t("pcModifiedCount", { count: modifiedCount })}
        </span>
        {modifiedCount > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({})}>
            <RotateCcw aria-hidden />
            {t("pcResetAll")}
          </Button>
        )}
      </div>

      {shown.length === 0 && <p className="text-muted-foreground py-6 text-center text-sm">{t("pcNoMatch")}</p>}

      {SCREENS[group].map((screen) => {
        const rows = shown.filter((e) => e.screen === screen.id);
        if (rows.length === 0) return null;
        return (
          <section key={screen.id} className="space-y-2" aria-label={screen.label[locale]}>
            <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{screen.label[locale]}</h4>
            <div className="space-y-2">
              {rows.map((entry) => (
                <TextRow
                  key={entry.id}
                  entry={entry}
                  value={texts[entry.id] ?? {}}
                  onText={(lang, v) => onChange(setText(texts, entry.id, lang, v))}
                  onReset={() => {
                    const next = { ...texts };
                    delete next[entry.id];
                    onChange(next);
                  }}
                  onFocusEntry={() => onFocusEntry(entry)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TextRow({
  entry,
  value,
  onText,
  onReset,
  onFocusEntry,
}: {
  entry: CatalogEntry;
  value: { ar?: string; en?: string };
  onText: (lang: Lang, v: string) => void;
  onReset: () => void;
  onFocusEntry: () => void;
}) {
  const t = useTranslations("settings");
  const locale = useLocale() as Lang;
  const refs = useRef<Partial<Record<Lang, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [last, setLast] = useState<Lang>("ar");
  const modified = !!(value.ar?.trim() || value.en?.trim());
  const long = entry.max > 100;

  const insert = (name: string) => {
    const el = refs.current[last];
    const current = value[last] ?? "";
    const token = `{${name}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onText(last, next.slice(0, entry.max));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div
      data-field=""
      className={cn("bg-card @container rounded-lg border p-3", modified && "border-brand/50")}
      onFocusCapture={onFocusEntry}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {entry.label[locale]}
          <InfoTip>{entry.hint[locale]}</InfoTip>
        </span>
        {modified && <Badge variant="secondary">{t("pcModified")}</Badge>}
        {modified && (
          <Button type="button" variant="ghost" size="xs" className="ms-auto" onClick={onReset}>
            <RotateCcw aria-hidden />
            {t("pcReset")}
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-2 @lg:grid-cols-2">
        {LANGS.map((lang) => {
          const v = value[lang] ?? "";
          const issue = v.trim() ? textIssue(entry.group, entry.id, v.trim()) : null;
          const common = {
            id: `pc-${entry.group}-${entry.id}-${lang}`,
            dir: LOCALES[lang].dir,
            lang,
            value: v,
            maxLength: entry.max,
            placeholder: defaultText(entry, lang),
            "aria-label": `${entry.label[locale]} (${LOCALES[lang].label})`,
            "aria-invalid": issue ? true : undefined,
            onFocus: () => setLast(lang),
            onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onText(lang, e.target.value),
          };
          return (
            <div key={lang} className="space-y-1">
              {long ? (
                <Textarea rows={2} ref={(el) => void (refs.current[lang] = el)} {...common} />
              ) : (
                <Input ref={(el) => void (refs.current[lang] = el)} {...common} />
              )}
              <div className="flex justify-between gap-2 text-xs">
                <span className={issue ? "text-destructive" : "text-muted-foreground"}>
                  {issue
                    ? issue.issue === "unknown_placeholder"
                      ? t("pcUnknownPlaceholder", { name: `{${issue.detail}}` })
                      : issue.issue === "too_long"
                        ? t("pcTooLong", { max: entry.max })
                        : t("pcStrayBrace")
                    : ""}
                </span>
                <span className="text-muted-foreground tabular" dir="ltr">
                  {v.length}/{entry.max}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {entry.placeholders.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("pcUsable")}</span>
          {entry.placeholders.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => insert(name)}
              title={t("pcInsert", { name: `{${name}}` })}
              className="bg-muted hover:bg-muted/70 focus-visible:ring-ring/50 rounded-md px-1.5 py-0.5 font-mono outline-none focus-visible:ring-3"
              dir="ltr"
            >
              {`{${name}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
