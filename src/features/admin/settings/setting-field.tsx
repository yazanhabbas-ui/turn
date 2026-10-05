"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { useTranslations } from "next-intl";
import { Field } from "@/components/admin/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export { Field };

/** Checkbox with label and hint. */
export function Check({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label data-field="" className="flex min-h-8 items-start gap-2.5 rounded-md py-1 text-sm">
      <input
        id={id}
        type="checkbox"
        disabled={disabled}
        className="accent-brand focus-visible:ring-ring/50 mt-0.5 size-4 shrink-0 rounded outline-none focus-visible:ring-3"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex items-center gap-1.5">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
    </label>
  );
}

export function NumField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  className,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function DigitsSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: "latn" | "arab";
  onChange: (v: "latn" | "arab") => void;
}) {
  const t = useTranslations("settings");
  return (
    <Field label={label} htmlFor={id}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as "latn" | "arab")}>
        <option value="latn">{t("digitsLatn")}</option>
        <option value="arab">{t("digitsArab")}</option>
      </NativeSelect>
    </Field>
  );
}
