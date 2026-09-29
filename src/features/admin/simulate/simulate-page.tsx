"use client";

import { Play, Plus, Trash2, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ErrorState, Field, LoadingRows, PageHeader } from "@/components/admin/form";
import { api, useApiMutation, useApiQuery } from "@/components/admin/use-api";
import { axisStyle, baseOption, CHART_THEME, EChart } from "@/components/charts/echart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODES, PUSH_STRATEGIES, type DistributionMode, type PushStrategy } from "@/domain/distribution/config";
import type { Reason } from "../types";
import { useLookups, useText } from "../use-lookups";

type Candidate = {
  mode: DistributionMode;
  strategies: PushStrategy[];
  sticky: boolean;
  maxWaitMinutes: number;
  priorityWeight: number;
  overflowLength: number;
};
type SimResult = {
  label: string;
  totals: {
    tickets: number;
    served: number;
    avgWait: number;
    medianWait: number;
    p90Wait: number;
    maxWait: number;
    slaPercent: number;
  };
  perReason: { reasonId: string; tickets: number; avgWait: number; p90Wait: number; slaPercent: number }[];
  perAgent: { agentId: string; served: number; busyMinutes: number; utilisation: number }[];
  fairness: number;
  queueLength: { minute: number; waiting: number }[];
};
type SimResponse = { arrivals: number; agents: string[]; results: SimResult[] };

const METRICS = [
  { key: "served", better: "high" },
  { key: "avgWait", better: "low" },
  { key: "medianWait", better: "low" },
  { key: "p90Wait", better: "low" },
  { key: "maxWait", better: "low" },
  { key: "slaPercent", better: "high" },
  { key: "fairness", better: "high" },
] as const;

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

function toConfig(c: Candidate) {
  return {
    mode: c.mode,
    push: { strategies: c.strategies },
    sticky: { enabled: c.sticky },
    ordering: { maxWaitMinutes: c.maxWaitMinutes, priorityWeight: c.priorityWeight },
    overflow: { maxQueueLength: c.overflowLength },
  };
}

export function SimulatePage() {
  const t = useTranslations("simulate");
  const td = useTranslations("distribution");
  const tu = useTranslations("ui");
  const text = useText();
  const lookups = useLookups();
  const reasons = useApiQuery<{ items: Reason[] }>("/api/v1/admin/reasons?archived=false");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [source, setSource] = useState<"synthetic" | "replay">("synthetic");
  const [total, setTotal] = useState(250);
  const [opens, setOpens] = useState("08:00");
  const [closes, setCloses] = useState("16:00");
  const [vip, setVip] = useState(2);
  const [elderly, setElderly] = useState(5);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [extraAgents, setExtraAgents] = useState(0);
  const [seed, setSeed] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([
    {
      mode: "push",
      strategies: ["proficiency", "least_waiting"],
      sticky: false,
      maxWaitMinutes: 45,
      priorityWeight: 1,
      overflowLength: 8,
    },
  ]);
  const [result, setResult] = useState<SimResponse | null>(null);

  const branch = branchId ?? lookups.data?.branches.find((b) => b.isDefault)?.id ?? lookups.data?.branches[0]?.id ?? null;
  const branchAgents = (lookups.data?.agents ?? []).filter((a) => a.branchId === branch);

  const run = useApiMutation(
    () =>
      api<SimResponse>("/api/v1/admin/simulate", {
        body: {
          branchId: branch,
          source:
            source === "synthetic"
              ? {
                  type: "synthetic",
                  total,
                  opensAt: toMin(opens),
                  closesAt: toMin(closes),
                  vipShare: vip / 100,
                  elderlyShare: elderly / 100,
                }
              : { type: "replay", date },
          agentIds: branchAgents.filter((a) => !excluded.includes(a.id)).map((a) => a.id),
          extraAgents,
          seed,
          serviceVariability: 0.5,
          scenarios: [
            { label: t("current"), useCurrent: true, config: {} },
            ...candidates.map((c, i) => ({ label: t("candidate", { n: i + 1 }), useCurrent: false, config: toConfig(c) })),
          ],
        },
      }),
    { onSuccess: setResult },
  );

  if (lookups.isLoading || reasons.isLoading) return <LoadingRows rows={6} />;
  if (!lookups.data || !reasons.data) return <ErrorState onRetry={() => lookups.refetch()} />;

  const agentName = (id: string) => {
    if (id.startsWith("extra-")) return t("extraAgentName", { n: id.slice(6) });
    const a = lookups.data!.agents.find((x) => x.id === id);
    return a ? text(a.displayName, a.email) : id;
  };
  const setCandidate = (i: number, patch: Partial<Candidate>) =>
    setCandidates(candidates.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const noAgents = branchAgents.length - excluded.length + extraAgents <= 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <form
        className="bg-card grid gap-6 rounded-xl border p-4 shadow-sm md:p-6 lg:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate(undefined);
        }}
      >
        <div className="space-y-4">
          <Field label={t("branch")} htmlFor="s-branch">
            <NativeSelect id="s-branch" value={branch ?? ""} onChange={(e) => setBranchId(e.target.value)}>
              {lookups.data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {text(b.name)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("source")}</legend>
            <div className="flex gap-4">
              {(["synthetic", "replay"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="source"
                    className="accent-brand size-4"
                    checked={source === s}
                    onChange={() => setSource(s)}
                  />
                  {t(s)}
                </label>
              ))}
            </div>
          </fieldset>
          {source === "synthetic" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("total")} htmlFor="s-total">
                <Input
                  id="s-total"
                  type="number"
                  min={1}
                  max={5000}
                  value={total}
                  onChange={(e) => setTotal(Number(e.target.value))}
                />
              </Field>
              <Field label={t("seed")} htmlFor="s-seed">
                <Input id="s-seed" type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </Field>
              <Field label={t("opens")} htmlFor="s-open">
                <Input id="s-open" type="time" dir="ltr" value={opens} onChange={(e) => setOpens(e.target.value)} />
              </Field>
              <Field label={t("closes")} htmlFor="s-close">
                <Input id="s-close" type="time" dir="ltr" value={closes} onChange={(e) => setCloses(e.target.value)} />
              </Field>
              <Field label={t("vipShare")} htmlFor="s-vip">
                <Input id="s-vip" type="number" min={0} max={100} value={vip} onChange={(e) => setVip(Number(e.target.value))} />
              </Field>
              <Field label={t("elderlyShare")} htmlFor="s-eld">
                <Input
                  id="s-eld"
                  type="number"
                  min={0}
                  max={100}
                  value={elderly}
                  onChange={(e) => setElderly(Number(e.target.value))}
                />
              </Field>
            </div>
          ) : (
            <Field label={t("date")} htmlFor="s-date">
              <Input id="s-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("agents")}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {branchAgents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand size-4"
                    checked={!excluded.includes(a.id)}
                    onChange={(e) => setExcluded(e.target.checked ? excluded.filter((x) => x !== a.id) : [...excluded, a.id])}
                  />
                  {text(a.displayName, a.email)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("extraAgents")} htmlFor="s-extra" className="max-w-40">
            <Input
              id="s-extra"
              type="number"
              min={0}
              max={50}
              value={extraAgents}
              onChange={(e) => setExtraAgents(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium">{t("scenarios")}</h2>
          <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            <span className="text-foreground font-medium">{t("current")}</span>
          </div>
          {candidates.map((c, i) => (
            <div key={i} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t("candidate", { n: i + 1 })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tu("remove")}
                  onClick={() => setCandidates(candidates.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={td("mode")}>
                  <NativeSelect value={c.mode} onChange={(e) => setCandidate(i, { mode: e.target.value as DistributionMode })}>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {td(`modes.${m}.title`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={td("strategies")}>
                  <NativeSelect
                    value={c.strategies[0]}
                    disabled={c.mode === "pull" || c.mode === "manual"}
                    onChange={(e) => setCandidate(i, { strategies: [e.target.value as PushStrategy, "round_robin"] })}
                  >
                    {PUSH_STRATEGIES.map((p) => (
                      <option key={p} value={p}>
                        {td(`strategyNames.${p}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={td("maxWait")}>
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    value={c.maxWaitMinutes}
                    onChange={(e) => setCandidate(i, { maxWaitMinutes: Number(e.target.value) })}
                  />
                </Field>
                <Field label={td("priorityWeight")}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={c.priorityWeight}
                    onChange={(e) => setCandidate(i, { priorityWeight: Number(e.target.value) })}
                  />
                </Field>
                <Field label={td("overflowLength")}>
                  <Input
                    type="number"
                    min={1}
                    value={c.overflowLength}
                    onChange={(e) => setCandidate(i, { overflowLength: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-brand size-4"
                  checked={c.sticky}
                  onChange={(e) => setCandidate(i, { sticky: e.target.checked })}
                />
                {td("stickyEnabled")}
              </label>
            </div>
          ))}
          {candidates.length < 3 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setCandidates([
                  ...candidates,
                  {
                    mode: "pull",
                    strategies: ["least_waiting", "round_robin"],
                    sticky: false,
                    maxWaitMinutes: 60,
                    priorityWeight: 1,
                    overflowLength: 10,
                  },
                ])
              }
            >
              <Plus aria-hidden />
              {t("addCandidate")}
            </Button>
          )}
          {noAgents && <p className="text-destructive text-sm">{t("noAgents")}</p>}
          <Button type="submit" className="w-full" disabled={run.isPending || noAgents}>
            <Play aria-hidden />
            {run.isPending ? t("running") : t("run")}
          </Button>
        </div>
      </form>

      {result ? (
        <Results
          result={result}
          agentName={agentName}
          reasonName={(id) => text(reasons.data!.items.find((r) => r.id === id)?.name)}
        />
      ) : (
        <p className="text-muted-foreground text-center">{t("empty")}</p>
      )}
    </div>
  );
}

function Results({
  result,
  agentName,
  reasonName,
}: {
  result: SimResponse;
  agentName: (id: string) => string;
  reasonName: (id: string) => string;
}) {
  const t = useTranslations("simulate");
  const theme = CHART_THEME.light;
  const value = (r: SimResult, key: (typeof METRICS)[number]["key"]) => (key === "fairness" ? r.fairness : r.totals[key]);

  const lineOption = useMemo(
    () => ({
      ...baseOption(theme),
      color: [...theme.series],
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: theme.axis } } },
      xAxis: {
        type: "category",
        data: result.results[0].queueLength.map((p) => hhmm(p.minute)),
        boundaryGap: false,
        ...axisStyle(theme),
        splitLine: { show: false },
      },
      yAxis: { type: "value", minInterval: 1, ...axisStyle(theme) },
      series: result.results.map((r) => ({
        name: r.label,
        type: "line",
        data: r.queueLength.map((p) => p.waiting),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2 },
        emphasis: { focus: "series" },
      })),
    }),
    [result, theme],
  );

  const agents = result.results[0].perAgent.map((a) => a.agentId);
  const barOption = useMemo(
    () => ({
      ...baseOption(theme),
      color: [...theme.series],
      tooltip: { ...baseOption(theme).tooltip, trigger: "item" },
      xAxis: { type: "value", minInterval: 1, ...axisStyle(theme) },
      yAxis: { type: "category", data: agents.map(agentName), inverse: true, ...axisStyle(theme), splitLine: { show: false } },
      series: result.results.map((r) => ({
        name: r.label,
        type: "bar",
        data: agents.map((id) => r.perAgent.find((a) => a.agentId === id)?.served ?? 0),
        barMaxWidth: 14,
        barGap: "20%",
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      })),
    }),
    [result, theme, agents, agentName],
  );

  return (
    <div className="space-y-6">
      <section className="bg-card rounded-xl border p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">{t("results")}</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("metric")}</TableHead>
                {result.results.map((r, i) => (
                  <TableHead key={r.label} className="text-end">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block size-2.5 rounded-sm"
                        style={{ backgroundColor: theme.series[i] }}
                        aria-hidden
                      />
                      {r.label}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map((m) => {
                const values = result.results.map((r) => value(r, m.key));
                const best = m.better === "low" ? Math.min(...values) : Math.max(...values);
                const distinct = new Set(values).size > 1;
                return (
                  <TableRow key={m.key}>
                    <TableCell>{t(`metrics.${m.key}`)}</TableCell>
                    {values.map((v, i) => (
                      <TableCell key={i} className="tabular text-end">
                        <span
                          className={
                            distinct && v === best ? "text-status-serving inline-flex items-center gap-1 font-semibold" : ""
                          }
                        >
                          {distinct && v === best && <Trophy className="size-3.5" aria-label={t("best")} />}
                          {v}
                        </span>
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="bg-card rounded-xl border p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">{t("queueOverTime")}</h2>
        <EChart option={lineOption} height={300} ariaLabel={t("queueOverTime")} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-card rounded-xl border p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">{t("perAgent")}</h2>
          <EChart option={barOption} height={Math.max(220, agents.length * 34 + 60)} ariaLabel={t("perAgent")} />
        </section>
        <section className="bg-card rounded-xl border p-4 shadow-sm">
          <h2 className="font-semibold">{t("perReason")}</h2>
          <p className="text-muted-foreground mb-2 text-xs">
            {t("metrics.avgWait")} · {t("metrics.slaPercent")}
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reason")}</TableHead>
                  {result.results.map((r) => (
                    <TableHead key={r.label} className="text-end">
                      {r.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.results[0].perReason
                  .filter((r) => r.tickets > 0)
                  .map((row) => (
                    <TableRow key={row.reasonId}>
                      <TableCell>
                        {reasonName(row.reasonId)} <span className="text-muted-foreground tabular text-xs">({row.tickets})</span>
                      </TableCell>
                      {result.results.map((r) => {
                        const x = r.perReason.find((p) => p.reasonId === row.reasonId)!;
                        return (
                          <TableCell key={r.label} className="tabular text-end text-sm">
                            {x.avgWait} · {x.slaPercent}%
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
