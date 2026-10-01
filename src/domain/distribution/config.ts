import { z } from "zod";

/** Auto-assign (push) sub-strategies. They can be chained: each one narrows ties left by the previous one. */
export const PUSH_STRATEGIES = [
  "rotation",
  "round_robin",
  "least_waiting",
  "longest_idle",
  "proficiency",
  "weighted",
  "random",
] as const;
export type PushStrategy = (typeof PUSH_STRATEGIES)[number];

/**
 * `round_robin` is a ready-made mode: every new ticket goes to the next agent in a fixed rotation. The engine sees it
 * as auto-assign with the `rotation` strategy (see `toEngineConfig`).
 */
export const MODES = ["pull", "push", "round_robin", "hybrid", "manual"] as const;
export type DistributionMode = (typeof MODES)[number];

const aging = z.object({ afterMinutes: z.number().int().min(1).max(600), boost: z.number().min(0).max(10_000) });

/**
 * Complete distribution configuration. Stored in distribution_rules.config (global, per branch, or per queue)
 * as a partial object; `resolveConfig` deep-merges queue → branch → global → defaults.
 */
export const distributionConfig = z.object({
  mode: z.enum(MODES).default("pull"),
  push: z
    .object({
      /** Strategy chain, e.g. proficiency → least_waiting → round_robin. */
      strategies: z.array(z.enum(PUSH_STRATEGIES)).min(1).max(6).default(["least_waiting", "round_robin"]),
    })
    .prefault({}),
  hybrid: z
    .object({
      /** Release a pre-assigned ticket to the pool if the agent has not called it within this time. */
      acceptTimeoutMinutes: z.number().min(0.5).max(120).default(3),
      alertSupervisor: z.boolean().default(true),
    })
    .prefault({}),
  sticky: z
    .object({
      /** Returning visitor (same phone) goes to the agent who served them last, if that agent is working. */
      enabled: z.boolean().default(false),
      withinDays: z.number().int().min(1).max(3650).default(90),
    })
    .prefault({}),
  ordering: z
    .object({
      /** Points per minute waited (FIFO strength). */
      waitWeight: z.number().min(0).max(100).default(1),
      /** Multiplier for the priority level weight (VIP, elderly, …). */
      priorityWeight: z.number().min(0).max(100).default(1),
      /** Points added as the wait approaches and passes the reason's SLA target. */
      slaWeight: z.number().min(0).max(100).default(1),
      /** Appointment tickets get this boost from `appointmentEarlyMinutes` before their slot. */
      appointmentBoost: z.number().min(0).max(10_000).default(200),
      appointmentEarlyMinutes: z.number().int().min(0).max(120).default(10),
      aging: z
        .array(aging)
        .max(10)
        .default([
          { afterMinutes: 20, boost: 30 },
          { afterMinutes: 40, boost: 80 },
        ]),
      /** Max wait guarantee: tickets waiting longer jump ahead of everyone (0 = off). */
      maxWaitMinutes: z.number().int().min(0).max(600).default(60),
      /** Separate lanes (priority levels with isLane) are served before the regular line. */
      lanesFirst: z.boolean().default(true),
    })
    .prefault({}),
  capacity: z
    .object({
      /** Count pre-assigned waiting tickets toward the agent's max concurrent load. */
      countAssignedWaiting: z.boolean().default(true),
    })
    .prefault({}),
  overflow: z
    .object({
      /** When a queue is over these limits, backup agents may serve it. */
      enabled: z.boolean().default(true),
      maxQueueLength: z.number().int().min(1).max(10_000).default(10),
      maxWaitMinutes: z.number().int().min(1).max(600).default(20),
      /** Backups always help when no primary agent is available. */
      backupsWhenNoPrimary: z.boolean().default(true),
    })
    .prefault({}),
  noShow: z
    .object({
      /** After calling, recall automatically every `recallAfterMinutes` up to `maxRecalls` times. */
      autoRecall: z.boolean().default(false),
      recallAfterMinutes: z.number().min(0.5).max(60).default(2),
      maxRecalls: z.number().int().min(0).max(10).default(2),
      /** Minutes after the last call before the ticket is treated as a no-show (0 = only manual). */
      timeoutMinutes: z.number().min(0).max(120).default(0),
      action: z.enum(["close", "requeue_end"]).default("close"),
    })
    .prefault({}),
  undo: z.object({ windowSeconds: z.number().int().min(0).max(3600).default(120) }).prefault({}),
});

export type DistributionConfig = z.infer<typeof distributionConfig>;
export type PartialDistributionConfig = z.input<typeof distributionConfig>;

export const DEFAULT_CONFIG: DistributionConfig = distributionConfig.parse({});

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge where arrays replace (so a queue can fully redefine its strategy chain or aging steps). */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue; // admin-supplied JSON must not reach the prototype
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

/** Most specific wins: queue override → branch override → global → defaults. Invalid stored layers are ignored. */
/** What the engine runs: the round robin mode is auto-assign with the strict rotation strategy. */
export function toEngineConfig(cfg: DistributionConfig): DistributionConfig {
  return cfg.mode === "round_robin" ? { ...cfg, mode: "push", push: { ...cfg.push, strategies: ["rotation"] } } : cfg;
}

export function resolveConfig(...layersGeneralToSpecific: (unknown | undefined | null)[]): DistributionConfig {
  let merged: unknown = {};
  for (const layer of layersGeneralToSpecific) {
    if (!isObject(layer)) continue;
    const candidate = deepMerge(merged, layer);
    if (distributionConfig.safeParse(candidate).success) merged = candidate;
  }
  return distributionConfig.parse(merged);
}
