import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { branches, distributionRules, queues, tickets, visitReasons } from "@/db/schema";
import { DEFAULT_CONFIG, deepMerge, distributionConfig, type PartialDistributionConfig } from "@/domain/distribution/config";
import { generateArrivals, simulate, type SimArrival, type SimInput } from "@/domain/simulation/simulate";
import { zonedParts } from "@/domain/schedule/time";
import { isoDate, uuid } from "@/domain/validation";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { loadBranchContext } from "../queue/snapshot";
import { allowedBranches, auditMeta, orgOf, requireOrgWide, requirePermission, type Actor } from "./actor";

export type RuleScope = "global" | "branch" | "queue";

export const ruleInput = z.object({
  scope: z.enum(["global", "branch", "queue"]),
  branchId: uuid.nullable().optional(),
  queueId: uuid.nullable().optional(),
  config: z.record(z.string(), z.unknown()),
});

/** A stored layer must produce a valid configuration once merged over the defaults. */
function validateLayer(config: Record<string, unknown>) {
  const parsed = distributionConfig.safeParse(deepMerge(DEFAULT_CONFIG, config));
  if (!parsed.success) {
    throw new AppError("validation", {
      issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
    });
  }
}

export async function listRules(actor: Actor) {
  requirePermission(actor, "distribution.manage");
  const org = orgOf(actor);
  const scope = allowedBranches(actor, "distribution.manage");
  const inScope = (branchId: string | null) => scope === "all" || (branchId !== null && scope.includes(branchId));
  const [rules, queueRows] = await Promise.all([
    db().select().from(distributionRules).where(eq(distributionRules.organizationId, org)),
    db()
      .select({ id: queues.id, branchId: queues.branchId, reasonId: queues.reasonId })
      .from(queues)
      .innerJoin(visitReasons, and(eq(visitReasons.id, queues.reasonId), isNull(visitReasons.archivedAt)))
      .where(eq(queues.organizationId, org)),
  ]);
  const queueBranch = new Map(queueRows.map((q) => [q.id, q.branchId]));
  return {
    defaults: DEFAULT_CONFIG,
    // The organization-wide rule is visible to everyone (read-only unless organization-wide); overrides only where allowed.
    rules: rules
      .filter((r) => r.scope === "global" || inScope(r.branchId ?? (r.queueId ? (queueBranch.get(r.queueId) ?? null) : null)))
      .map((r) => ({
        id: r.id,
        scope: r.scope as RuleScope,
        branchId: r.branchId,
        queueId: r.queueId,
        config: r.config,
        version: r.version,
        updatedAt: r.updatedAt,
      })),
    queues: queueRows.filter((q) => inScope(q.branchId)),
  };
}

export async function putRule(actor: Actor, input: z.infer<typeof ruleInput>) {
  requirePermission(actor, "distribution.manage", input.branchId ?? undefined);
  if (input.scope === "global") requireOrgWide(actor, "distribution.manage");
  const org = orgOf(actor);
  validateLayer(input.config);
  const branchId = input.scope === "global" ? null : (input.branchId ?? null);
  let queueId: string | null = null;
  if (input.scope === "branch" && !branchId) throw new AppError("validation", { field: "branchId" });
  if (input.scope === "queue") {
    const [q] = input.queueId
      ? await db()
          .select()
          .from(queues)
          .where(and(eq(queues.id, input.queueId), eq(queues.organizationId, org)))
      : [];
    if (!q) throw new AppError("validation", { field: "queueId" });
    queueId = q.id;
    requirePermission(actor, "distribution.manage", q.branchId);
  }
  if (branchId) {
    const [b] = await db()
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, org)));
    if (!b) throw new AppError("validation", { field: "branchId" });
  }

  return db().transaction(async (tx) => {
    const existing = await tx.select().from(distributionRules).where(eq(distributionRules.organizationId, org));
    const current = existing.find((r) =>
      input.scope === "global"
        ? r.scope === "global"
        : input.scope === "branch"
          ? r.scope === "branch" && r.branchId === branchId
          : r.scope === "queue" && r.queueId === queueId,
    );
    let id: string;
    if (current) {
      await tx
        .update(distributionRules)
        .set({ config: input.config, version: current.version + 1, updatedByUserId: actor.auth.user.id })
        .where(eq(distributionRules.id, current.id));
      id = current.id;
    } else {
      const [row] = await tx
        .insert(distributionRules)
        .values({
          organizationId: org,
          scope: input.scope,
          branchId: input.scope === "queue" ? null : branchId,
          queueId,
          config: input.config,
          updatedByUserId: actor.auth.user.id,
        })
        .returning();
      id = row.id;
    }
    await audit(
      {
        ...auditMeta(actor),
        branchId,
        action: "distribution.updated",
        entityType: "distribution_rule",
        entityId: id,
        before: current?.config ?? null,
        after: input.config,
      },
      tx,
    );
    return { id };
  });
}

/** Removes a branch or queue override so the scope inherits again. The global rule cannot be removed. */
export async function deleteRule(actor: Actor, id: string) {
  requirePermission(actor, "distribution.manage");
  const [r] = await db()
    .select()
    .from(distributionRules)
    .where(and(eq(distributionRules.id, id), eq(distributionRules.organizationId, orgOf(actor))));
  if (!r) throw new AppError("not_found");
  if (r.scope === "global") throw new AppError("conflict", { reason: "global_rule" });
  const ruleBranch =
    r.branchId ??
    (r.queueId ? ((await db().select({ b: queues.branchId }).from(queues).where(eq(queues.id, r.queueId)))[0]?.b ?? null) : null);
  if (ruleBranch) requirePermission(actor, "distribution.manage", ruleBranch);
  else requireOrgWide(actor, "distribution.manage");
  await db().delete(distributionRules).where(eq(distributionRules.id, id));
  await audit({
    ...auditMeta(actor),
    action: "distribution.override_removed",
    entityType: "distribution_rule",
    entityId: id,
    before: r.config,
  });
}

// ─── Simulation ──────────────────────────────────────────────────────────────

export const simulateInput = z.object({
  branchId: uuid,
  source: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("synthetic"),
      total: z.number().int().min(1).max(5000),
      opensAt: z.number().int().min(0).max(1439).default(480),
      closesAt: z.number().int().min(1).max(1440).default(960),
      /** Relative share per reason id; missing = equal. */
      reasonMix: z.record(z.string(), z.number().min(0)).optional(),
      vipShare: z.number().min(0).max(1).default(0.02),
      elderlyShare: z.number().min(0).max(1).default(0.05),
    }),
    z.object({ type: z.literal("replay"), date: isoDate }),
  ]),
  /** Agents to include (default: all agents of the branch). */
  agentIds: z.array(uuid).max(500).optional(),
  /** Extra generic agents (serve every reason as primary) for staffing what-ifs. */
  extraAgents: z.number().int().min(0).max(50).default(0),
  scenarios: z
    .array(
      z.object({
        label: z.string().max(60),
        useCurrent: z.boolean().default(false),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(4),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31)
    .default(1),
  serviceVariability: z.number().min(0).max(2).default(0.5),
});

export async function runSimulation(actor: Actor, input: z.infer<typeof simulateInput>) {
  requirePermission(actor, "distribution.simulate", input.branchId);
  for (const s of input.scenarios) if (!s.useCurrent) validateLayer(s.config);

  const { snapshot, branch, configFor } = await db().transaction((tx) => loadBranchContext(tx, input.branchId));
  if (branch.organizationId !== orgOf(actor)) throw new AppError("not_found");
  const reasonRows = await db()
    .select({
      id: visitReasons.id,
      sla: visitReasons.slaTargetWaitMinutes,
      expected: visitReasons.expectedServiceMinutes,
      queueId: queues.id,
    })
    .from(visitReasons)
    .innerJoin(queues, and(eq(queues.reasonId, visitReasons.id), eq(queues.branchId, input.branchId)))
    .where(and(eq(visitReasons.organizationId, branch.organizationId), isNull(visitReasons.archivedAt)));
  const reasons = reasonRows.map((r) => ({ id: r.id, slaMinutes: r.sla, expectedMinutes: r.expected }));

  let arrivals: SimArrival[];
  if (input.source.type === "synthetic") {
    const src = input.source;
    const mix =
      src.reasonMix && Object.keys(src.reasonMix).length ? src.reasonMix : Object.fromEntries(reasons.map((r) => [r.id, 1]));
    arrivals = generateArrivals(
      {
        open: [src.opensAt, Math.max(src.opensAt + 1, src.closesAt)],
        total: src.total,
        reasonMix: mix,
        priorityMix: { vip: src.vipShare, elderly: src.elderlyShare },
      },
      input.seed,
    );
  } else {
    const rows = await db()
      .select({ arrivedAt: tickets.arrivedAt, reasonId: tickets.reasonId, priorityKey: tickets.priorityKey })
      .from(tickets)
      .where(and(eq(tickets.branchId, input.branchId), eq(tickets.serviceDay, input.source.date)));
    arrivals = rows.map((r) => ({
      at: zonedParts(r.arrivedAt, branch.timezone).minutes,
      reasonId: r.reasonId,
      priorityKey: r.priorityKey,
    }));
    if (!arrivals.length) throw new AppError("validation", { reason: "no_tickets_that_day" });
  }

  const chosen = snapshot.agents.filter((a) => !input.agentIds || input.agentIds.includes(a.id));
  const agents: SimInput["agents"] = chosen.map((a) => ({
    id: a.id,
    maxConcurrent: a.maxConcurrent,
    weight: a.weight,
    skills: Object.fromEntries(a.skills),
  }));
  for (let i = 0; i < input.extraAgents; i++) {
    agents.push({
      id: `extra-${i + 1}`,
      maxConcurrent: 1,
      weight: 1,
      skills: Object.fromEntries(reasons.map((r) => [r.id, { proficiency: 3, isPrimary: true }])),
    });
  }
  if (!agents.length) throw new AppError("validation", { reason: "no_agents" });
  const priorities = Object.fromEntries(snapshot.priorities);

  const results = input.scenarios.map((sc) => {
    // "Current rules" reproduces exactly what production would do: the resolved config of every queue.
    const perReason: Record<string, PartialDistributionConfig> = {};
    let config: PartialDistributionConfig = sc.config as PartialDistributionConfig;
    if (sc.useCurrent) {
      config = {};
      for (const r of reasonRows) perReason[r.id] = configFor(r.queueId);
    }
    const res = simulate({
      reasons,
      agents,
      arrivals,
      priorities,
      config,
      perReason,
      seed: input.seed,
      serviceVariability: input.serviceVariability,
    });
    return { label: sc.label, ...res, tickets: undefined };
  });

  return { arrivals: arrivals.length, agents: agents.map((a) => a.id), results };
}
