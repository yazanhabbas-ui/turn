"use client";

import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { ErrorState, Field, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MODES, PUSH_STRATEGIES, resolveConfig, type DistributionConfig, type PushStrategy } from "@/domain/distribution/config";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Reason } from "../types";
import { useLookups, useText } from "../use-lookups";

const RULES = "/api/v1/admin/distribution-rules";

type Rule = {
  id: string;
  scope: "global" | "branch" | "queue";
  branchId: string | null;
  queueId: string | null;
  config: Record<string, unknown>;
};
type RulesData = { rules: Rule[]; queues: { id: string; branchId: string; reasonId: string }[] };
type Scope = { key: string; scope: Rule["scope"]; branchId: string | null; queueId: string | null };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-xl border p-4 shadow-sm md:p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="font-semibold">{title}</h2>
        {hint && <InfoTip>{hint}</InfoTip>}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Num({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 10_000,
  step = 1,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function DistributionPage() {
  const t = useTranslations("distribution");
  const text = useText();
  const lookups = useLookups();
  const rules = useApiQuery<RulesData>(RULES);
  const reasons = useApiQuery<{ items: Reason[] }>("/api/v1/admin/reasons?archived=false");
  const [scopeKey, setScopeKey] = useState("global");

  const scopes = useMemo<Scope[]>(() => {
    if (!lookups.data || !rules.data) return [];
    const list: Scope[] = [{ key: "global", scope: "global", branchId: null, queueId: null }];
    for (const b of lookups.data.branches) list.push({ key: `b:${b.id}`, scope: "branch", branchId: b.id, queueId: null });
    for (const q of rules.data.queues) list.push({ key: `q:${q.id}`, scope: "queue", branchId: q.branchId, queueId: q.id });
    return list;
  }, [lookups.data, rules.data]);

  if (lookups.isLoading || rules.isLoading || reasons.isLoading) return <LoadingRows rows={8} />;
  if (!lookups.data || !rules.data || !reasons.data) return <ErrorState onRetry={() => rules.refetch()} />;

  const branchName = (id: string | null) => text(lookups.data!.branches.find((b) => b.id === id)?.name);
  const scopeLabel = (s: Scope) => {
    if (s.scope === "global") return t("scopeGlobal");
    if (s.scope === "branch") return t("scopeBranch", { name: branchName(s.branchId) });
    const q = rules.data!.queues.find((x) => x.id === s.queueId)!;
    return t("scopeQueue", {
      reason: text(reasons.data!.items.find((r) => r.id === q.reasonId)?.name),
      branch: branchName(q.branchId),
    });
  };
  const scope = scopes.find((s) => s.key === scopeKey) ?? scopes[0];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/simulate" />}>
            <FlaskConical aria-hidden />
            {t("tryInSimulator")}
          </Button>
        }
      />
      <Field label={t("scope")} htmlFor="d-scope" className="mb-5 max-w-lg">
        <NativeSelect id="d-scope" value={scope.key} onChange={(e) => setScopeKey(e.target.value)}>
          {scopes.map((s) => (
            <option key={s.key} value={s.key}>
              {scopeLabel(s)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <RuleEditor key={scope.key} scope={scope} rules={rules.data.rules} queues={rules.data.queues} />
    </div>
  );
}

/** The layers that apply to a scope, most general first. */
function layersFor(scope: Scope, rules: Rule[], queues: RulesData["queues"]) {
  const global = rules.find((r) => r.scope === "global");
  const branchId = scope.scope === "queue" ? queues.find((q) => q.id === scope.queueId)?.branchId : scope.branchId;
  const branch = branchId ? rules.find((r) => r.scope === "branch" && r.branchId === branchId) : undefined;
  const queue = scope.scope === "queue" ? rules.find((r) => r.scope === "queue" && r.queueId === scope.queueId) : undefined;
  const own = scope.scope === "global" ? global : scope.scope === "branch" ? branch : queue;
  const upto = scope.scope === "global" ? [global] : scope.scope === "branch" ? [global, branch] : [global, branch, queue];
  return { own, layers: upto.map((r) => r?.config) };
}

function RuleEditor({ scope, rules, queues }: { scope: Scope; rules: Rule[]; queues: RulesData["queues"] }) {
  const t = useTranslations("distribution");
  const tu = useTranslations("ui");
  const { own, layers } = layersFor(scope, rules, queues);
  const [cfg, setCfg] = useState<DistributionConfig>(() => resolveConfig(...layers));
  useEffect(() => setCfg(resolveConfig(...layers)), [JSON.stringify(layers)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof DistributionConfig>(k: K, patch: Partial<DistributionConfig[K]>) =>
    setCfg((c) => ({ ...c, [k]: { ...(c[k] as object), ...patch } }));
  const invalidate = [[RULES]];
  const save = useApiMutation(
    () =>
      api(RULES, { method: "PUT", body: { scope: scope.scope, branchId: scope.branchId, queueId: scope.queueId, config: cfg } }),
    { invalidate, success: t("saved") },
  );
  const remove = useApiMutation(() => api(`${RULES}/${own!.id}`, { method: "DELETE" }), { invalidate });
  const chain = cfg.push.strategies;
  const moveStep = (i: number, d: -1 | 1) => {
    const next = [...chain];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set("push", { strategies: next });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      {scope.scope !== "global" && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {own ? t("overridden") : t("inherited")}
            {own && (
              <ConfirmButton
                label={t("removeOverride")}
                title={t("removeOverrideTitle")}
                description={t("removeOverrideBody")}
                onConfirm={() => remove.mutateAsync(undefined)}
              />
            )}
          </AlertDescription>
        </Alert>
      )}

      <Section title={t("mode")}>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("mode")}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={cfg.mode === m}
              onClick={() => setCfg((c) => ({ ...c, mode: m }))}
              className={cn(
                "rounded-xl border p-4 text-start transition",
                cfg.mode === m ? "border-brand bg-brand/5 ring-brand/30 ring-2" : "hover:bg-muted/50",
              )}
            >
              <div className="font-semibold">{t(`modes.${m}.title`)}</div>
              <p className="text-muted-foreground mt-1 text-sm">{t(`modes.${m}.body`)}</p>
            </button>
          ))}
        </div>
      </Section>

      {(cfg.mode === "push" || cfg.mode === "hybrid") && (
        <Section title={t("strategies")} hint={t("strategiesHint")}>
          <ol className="space-y-2">
            {chain.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="bg-brand/10 text-brand tabular grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold">
                  {i + 1}
                </span>
                <NativeSelect
                  aria-label={t("strategies")}
                  value={s}
                  onChange={(e) =>
                    set("push", { strategies: chain.map((x, j) => (j === i ? (e.target.value as PushStrategy) : x)) })
                  }
                >
                  {PUSH_STRATEGIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`strategyNames.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("moveUp")}
                  disabled={i === 0}
                  onClick={() => moveStep(i, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("moveDown")}
                  disabled={i === chain.length - 1}
                  onClick={() => moveStep(i, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tu("remove")}
                  disabled={chain.length === 1}
                  onClick={() => set("push", { strategies: chain.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {chain.length < 6 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set("push", { strategies: [...chain, PUSH_STRATEGIES.find((p) => !chain.includes(p)) ?? "round_robin"] })
              }
            >
              <Plus aria-hidden />
              {t("addStep")}
            </Button>
          )}
        </Section>
      )}

      {cfg.mode === "hybrid" && (
        <Section title={t("hybrid")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              id="h-timeout"
              label={t("acceptTimeout")}
              value={cfg.hybrid.acceptTimeoutMinutes}
              min={0.5}
              max={120}
              step={0.5}
              onChange={(v) => set("hybrid", { acceptTimeoutMinutes: v })}
            />
          </div>
          <Check
            label={t("alertSupervisor")}
            checked={cfg.hybrid.alertSupervisor}
            onChange={(v) => set("hybrid", { alertSupervisor: v })}
          />
        </Section>
      )}

      <Section title={t("sticky")}>
        <Check label={t("stickyEnabled")} checked={cfg.sticky.enabled} onChange={(v) => set("sticky", { enabled: v })} />
      </Section>

      <Section title={t("ordering")} hint={t("orderingHint")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Num
            id="o-wait"
            label={t("waitWeight")}
            value={cfg.ordering.waitWeight}
            max={100}
            step={0.1}
            onChange={(v) => set("ordering", { waitWeight: v })}
          />
          <Num
            id="o-prio"
            label={t("priorityWeight")}
            value={cfg.ordering.priorityWeight}
            max={100}
            step={0.1}
            onChange={(v) => set("ordering", { priorityWeight: v })}
          />
          <Num
            id="o-sla"
            label={t("slaWeight")}
            value={cfg.ordering.slaWeight}
            max={100}
            step={0.1}
            onChange={(v) => set("ordering", { slaWeight: v })}
          />
          <Num
            id="o-appt"
            label={t("appointmentBoost")}
            value={cfg.ordering.appointmentBoost}
            onChange={(v) => set("ordering", { appointmentBoost: v })}
          />
          <Num
            id="o-early"
            label={t("appointmentEarly")}
            value={cfg.ordering.appointmentEarlyMinutes}
            max={120}
            onChange={(v) => set("ordering", { appointmentEarlyMinutes: v })}
          />
          <Num
            id="o-max"
            label={t("maxWait")}
            hint={t("maxWaitHint")}
            value={cfg.ordering.maxWaitMinutes}
            max={600}
            onChange={(v) => set("ordering", { maxWaitMinutes: v })}
          />
        </div>
        <Check label={t("lanesFirst")} checked={cfg.ordering.lanesFirst} onChange={(v) => set("ordering", { lanesFirst: v })} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            <span className="flex items-center gap-1.5">
              {t("aging")}
              <InfoTip>{t("agingHint")}</InfoTip>
            </span>
          </legend>
          <div className="space-y-2">
            {cfg.ordering.aging.map((a, i) => (
              <div key={i} className="flex items-end gap-2">
                <Num
                  id={`ag-a-${i}`}
                  label={t("agingAfter")}
                  value={a.afterMinutes}
                  min={1}
                  max={600}
                  onChange={(v) =>
                    set("ordering", { aging: cfg.ordering.aging.map((x, j) => (j === i ? { ...x, afterMinutes: v } : x)) })
                  }
                />
                <Num
                  id={`ag-b-${i}`}
                  label={t("agingBoost")}
                  value={a.boost}
                  onChange={(v) =>
                    set("ordering", { aging: cfg.ordering.aging.map((x, j) => (j === i ? { ...x, boost: v } : x)) })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tu("remove")}
                  onClick={() => set("ordering", { aging: cfg.ordering.aging.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set("ordering", { aging: [...cfg.ordering.aging, { afterMinutes: 30, boost: 50 }] })}
            >
              <Plus aria-hidden />
              {t("addAging")}
            </Button>
          </div>
        </fieldset>
      </Section>

      <Section title={t("capacity")}>
        <Check
          label={t("countReserved")}
          checked={cfg.capacity.countAssignedWaiting}
          onChange={(v) => set("capacity", { countAssignedWaiting: v })}
        />
      </Section>

      <Section title={t("overflow")}>
        <Check label={t("overflowEnabled")} checked={cfg.overflow.enabled} onChange={(v) => set("overflow", { enabled: v })} />
        {cfg.overflow.enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              id="ov-len"
              label={t("overflowLength")}
              value={cfg.overflow.maxQueueLength}
              min={1}
              onChange={(v) => set("overflow", { maxQueueLength: v })}
            />
            <Num
              id="ov-wait"
              label={t("overflowWait")}
              value={cfg.overflow.maxWaitMinutes}
              min={1}
              max={600}
              onChange={(v) => set("overflow", { maxWaitMinutes: v })}
            />
          </div>
        )}
        <Check
          label={t("backupsWhenNoPrimary")}
          checked={cfg.overflow.backupsWhenNoPrimary}
          onChange={(v) => set("overflow", { backupsWhenNoPrimary: v })}
        />
      </Section>

      <Section title={t("noShow")}>
        <Check label={t("autoRecall")} checked={cfg.noShow.autoRecall} onChange={(v) => set("noShow", { autoRecall: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          {cfg.noShow.autoRecall && (
            <>
              <Num
                id="ns-every"
                label={t("recallAfter")}
                value={cfg.noShow.recallAfterMinutes}
                min={0.5}
                max={60}
                step={0.5}
                onChange={(v) => set("noShow", { recallAfterMinutes: v })}
              />
              <Num
                id="ns-max"
                label={t("maxRecalls")}
                value={cfg.noShow.maxRecalls}
                max={10}
                onChange={(v) => set("noShow", { maxRecalls: v })}
              />
            </>
          )}
          <Num
            id="ns-timeout"
            label={t("noShowTimeout")}
            value={cfg.noShow.timeoutMinutes}
            max={120}
            step={0.5}
            onChange={(v) => set("noShow", { timeoutMinutes: v })}
          />
          <Field label={t("noShowAction")} htmlFor="ns-action">
            <NativeSelect
              id="ns-action"
              value={cfg.noShow.action}
              onChange={(e) => set("noShow", { action: e.target.value as "close" | "requeue_end" })}
            >
              <option value="close">{t("noShowClose")}</option>
              <option value="requeue_end">{t("noShowRequeue")}</option>
            </NativeSelect>
          </Field>
        </div>
        <Num
          id="undo"
          label={t("undo")}
          value={cfg.undo.windowSeconds}
          max={3600}
          onChange={(v) => set("undo", { windowSeconds: v })}
        />
      </Section>

      <div className="bg-background/95 sticky bottom-0 flex justify-end border-t py-3 backdrop-blur">
        <Button type="submit" disabled={save.isPending}>
          {tu("save")}
        </Button>
      </div>
    </form>
  );
}
