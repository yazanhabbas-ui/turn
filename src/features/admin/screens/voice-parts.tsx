"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";

/** A titled group of voice settings. */
export function SettingCard({
  title,
  hint,
  children,
  id,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="bg-card space-y-4 rounded-xl border p-4 shadow-sm md:p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold">{title}</h3>
          {hint && <InfoTip>{hint}</InfoTip>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A labelled slider that shows its value with the unit, e.g. "Between the letter and the number: 120 ms". */
export function Range({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {hint && <InfoTip>{hint}</InfoTip>}
        </div>
        <span className="text-sm font-medium tabular-nums" dir="ltr">
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        className="accent-brand w-full"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
