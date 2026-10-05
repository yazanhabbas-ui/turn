"use client";

import { InfoTip } from "@/components/ui/info-tip";

export function Check({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="inline-flex items-center gap-1.5">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
    </label>
  );
}
