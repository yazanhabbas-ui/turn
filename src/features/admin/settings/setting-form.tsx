"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, useErrorMessage } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { SettingKey, SettingValue } from "@/server/settings/registry";
import { scopeQuery, useSettingsScope, useSettingsShell } from "./settings-context";

export const SETTINGS = "/api/v1/admin/settings";

/**
 * Form for one setting group. Keeps a local draft and saves it with PUT (same API body as before). While the draft
 * differs from the saved value a sticky bar offers Save (Ctrl/Cmd+S) and Discard; API errors show inline.
 */
export function SettingForm<K extends SettingKey>({
  k,
  initial,
  children,
}: {
  k: K;
  initial: SettingValue<K>;
  children: (v: SettingValue<K>, set: (patch: Partial<SettingValue<K>>) => void) => React.ReactNode;
}) {
  const t = useTranslations("settings");
  const tu = useTranslations("ui");
  const router = useRouter();
  const qc = useQueryClient();
  const message = useErrorMessage();
  const shell = useSettingsShell();
  // Saves to the scope picked at the top of the page: the organization default, or a city's or branch's own value.
  const scope = useSettingsScope();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // When the saved value changes (own save, or the logo uploader saving logoUrl), take over only the keys that changed
  // so edits to other fields in the draft survive.
  const previous = useRef(initial);
  useEffect(() => {
    const before = previous.current as Record<string, unknown>;
    const now = initial as Record<string, unknown>;
    previous.current = initial;
    const changed = Object.keys(now).filter((key) => JSON.stringify(now[key]) !== JSON.stringify(before[key]));
    if (changed.length) setDraft((d) => ({ ...d, ...Object.fromEntries(changed.map((key) => [key, now[key]])) }));
  }, [initial]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  const save = useMutation({
    mutationFn: () => api(`${SETTINGS}/${k}${scopeQuery(scope)}`, { method: "PUT", body: draft }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      toast.success(t("saved"));
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(SETTINGS) });
      // Branding and language affect the server-rendered shell; refresh it.
      router.refresh();
    },
    onError: (err) => setError(message(err)),
  });

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    shell.setDirty(formId, dirty);
    return () => shell.setDirty(formId, false);
  }, [dirty, formId, shell]);

  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);

  const showBar = dirty || saved || !!error;
  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      {children(draft, (patch) => {
        setSaved(false);
        setDraft((d) => ({ ...d, ...patch }));
      })}
      {showBar && (
        <div
          className="bg-card sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border p-3 shadow-lg"
          role="region"
          aria-label={t("ui.unsaved")}
        >
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {error ? (
              <span className="text-destructive flex items-start gap-1.5" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </span>
            ) : dirty ? (
              <span className="flex items-center gap-2 font-medium">
                <span className="bg-brand size-2 shrink-0 rounded-full" aria-hidden />
                {t("ui.unsaved")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" aria-hidden />
                {t("ui.allSaved")}
              </span>
            )}
          </div>
          {dirty && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="max-lg:h-10"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(initial);
                  setError(null);
                }}
              >
                {t("ui.discard")}
              </Button>
              <Button type="submit" className="max-lg:h-10" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                {tu("save")}
              </Button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
