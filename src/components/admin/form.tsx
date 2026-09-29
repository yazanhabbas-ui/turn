"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOCALE_CODES, LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

export type LocalizedValue = Record<string, string>;

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

/** One input per UI language, each with its own text direction. Arabic first. */
export function LocalizedInput({
  id,
  label,
  value,
  onChange,
  required,
  multiline,
  maxLength,
}: {
  id: string;
  label: string;
  value: LocalizedValue | null | undefined;
  onChange: (v: LocalizedValue) => void;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
}) {
  const v = value ?? {};
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {LOCALE_CODES.map((code, i) => {
          const Comp = multiline ? Textarea : Input;
          return (
            <div key={code} className="relative">
              <Comp
                id={`${id}-${code}`}
                dir={LOCALES[code].dir}
                lang={code}
                value={v[code] ?? ""}
                maxLength={maxLength}
                required={required && i === 0}
                aria-label={`${label} (${LOCALES[code].label})`}
                placeholder={LOCALES[code].label}
                onChange={(e) => onChange({ ...v, [code]: e.target.value })}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("ui");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs https or localhost; fall back to selecting the text for manual copy.
      const el = document.getElementById("copy-field-input") as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="space-y-1.5">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <Input
          id="copy-field-input"
          readOnly
          value={value}
          dir="ltr"
          className="font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <Button type="button" variant="outline" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center">
      <p>{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bg-muted h-12 animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations("common");
  return (
    <div className="border-destructive/30 bg-destructive/5 rounded-xl border p-6 text-center">
      <p className="text-destructive">{t("somethingWrong")}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
