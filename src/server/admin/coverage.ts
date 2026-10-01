import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { agentProfiles, branches, displays, hallReasons, halls, settings, users, visitReasons } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { agentIssuingState, resetReceptionCache } from "../queue/reception-status";
import { getSetting, putSetting } from "../settings/service";
import { auditMeta, orgOf, requirePermission, type Actor } from "./actor";
import { visibleBranchIds } from "./branches";

/**
 * A hall-delivery reason (D62) that nobody can serve in a branch: the halls feature is off for it, no hall accepts it,
 * or no agent is set up to host a hall.
 */
export type HallGap = {
  type: "halls_disabled" | "no_hall" | "no_host";
  /** The hall-delivery reasons affected (all of them for halls_disabled and no_host). */
  reasonIds: string[];
};

export type BranchCoverage = {
  branchId: string;
  cityId: string;
  name: Record<string, string>;
  /** A receptionist covers the branch (an active user with a reception role on it, its city, or organization-wide). */
  hasReception: boolean;
  agentIssuing: "off" | "when_no_reception" | "always";
  /** Agents of the branch may issue walk-in tickets right now. */
  agentAllowed: boolean;
  kiosks: { total: number; paired: number };
  selfCheckinEnabled: boolean;
  /** At least one way to get a ticket exists: a receptionist, agent walk-in issuing, or a paired and enabled kiosk. */
  canIssue: boolean;
  /** Hall-delivery reasons that cannot be served here (empty when there are none or all are covered). */
  hallGaps: HallGap[];
  /** The halls feature is on for this branch (settings group `halls`). */
  hallsEnabled: boolean;
};

async function hallGapsOf(branchId: string, enabled: boolean, hallReasonIds: string[]): Promise<HallGap[]> {
  if (!hallReasonIds.length) return [];
  if (!enabled) return [{ type: "halls_disabled", reasonIds: hallReasonIds }];
  const [hallRows, links, hosts] = await Promise.all([
    db()
      .select({ id: halls.id })
      .from(halls)
      .where(and(eq(halls.branchId, branchId), isNull(halls.archivedAt))),
    db()
      .select({ hallId: hallReasons.hallId, reasonId: hallReasons.reasonId })
      .from(hallReasons)
      .innerJoin(halls, eq(halls.id, hallReasons.hallId))
      .where(and(eq(halls.branchId, branchId), isNull(halls.archivedAt))),
    db()
      .select({ userId: agentProfiles.userId })
      .from(agentProfiles)
      .innerJoin(users, eq(users.id, agentProfiles.userId))
      .where(
        and(
          eq(agentProfiles.branchId, branchId),
          eq(users.isActive, true),
          isNull(users.archivedAt),
          or(isNotNull(agentProfiles.defaultHallId), isNotNull(agentProfiles.currentHallId)),
        ),
      )
      .limit(1),
  ]);
  const gaps: HallGap[] = [];
  // A hall with no linked reasons accepts every hall reason.
  const acceptsAll = hallRows.some((h) => !links.some((l) => l.hallId === h.id));
  const uncovered = acceptsAll ? [] : hallReasonIds.filter((r) => !links.some((l) => l.reasonId === r));
  if (uncovered.length) gaps.push({ type: "no_hall", reasonIds: uncovered });
  if (!hosts.length) gaps.push({ type: "no_host", reasonIds: hallReasonIds });
  return gaps;
}

/**
 * Per branch the actor can see: how a visitor can get a ticket (D61). A city admin sees only their own city's
 * branches. Used by the badges on Cities and Branches and the "no way to issue tickets" card on the overview.
 */
export async function issuingCoverage(actor: Actor): Promise<BranchCoverage[]> {
  const org = orgOf(actor);
  const ids = await visibleBranchIds(actor, "admin.access");
  if (!ids.length) return [];
  const [rows, kioskRows, hallReasonRows] = await Promise.all([
    db()
      .select({ id: branches.id, cityId: branches.cityId, name: branches.name })
      .from(branches)
      .where(inArray(branches.id, ids)),
    db()
      .select({ branchId: displays.branchId, tokenHash: displays.tokenHash, revokedAt: displays.revokedAt })
      .from(displays)
      .where(and(inArray(displays.branchId, ids), eq(displays.kind, "kiosk"), isNull(displays.archivedAt))),
    db()
      .select({ id: visitReasons.id })
      .from(visitReasons)
      .where(and(eq(visitReasons.organizationId, org), eq(visitReasons.delivery, "hall"), isNull(visitReasons.archivedAt))),
  ]);
  const hallReasonIds = hallReasonRows.map((r) => r.id);
  return Promise.all(
    rows.map(async (b) => {
      const [state, sc, hs] = await Promise.all([
        agentIssuingState(org, b.id),
        getSetting(org, "selfCheckin", b.id),
        getSetting(org, "halls", b.id),
      ]);
      const hallGaps = await hallGapsOf(b.id, hs.enabled, hallReasonIds);
      const mine = kioskRows.filter((k) => k.branchId === b.id);
      const paired = mine.filter((k) => k.tokenHash && !k.revokedAt).length;
      return {
        branchId: b.id,
        cityId: b.cityId,
        name: b.name,
        hasReception: state.hasReception,
        agentIssuing: state.mode,
        agentAllowed: state.allowed,
        kiosks: { total: mine.length, paired },
        selfCheckinEnabled: sc.enabled,
        canIssue: state.hasReception || state.allowed || (sc.enabled && paired > 0),
        hallGaps,
        hallsEnabled: hs.enabled,
      };
    }),
  );
}

/**
 * One-click fix for a branch without a way to issue tickets: gives the branch its own `reception.agentIssuing =
 * when_no_reception` (agents may issue walk-ins while nobody is at the desk). Only that one key is stored on the branch,
 * so the rest of the reception settings keep inheriting from the city and the organization.
 */
export async function enableAgentIssuing(actor: Actor, branchId: string) {
  const [b] = await db().select({ organizationId: branches.organizationId }).from(branches).where(eq(branches.id, branchId));
  if (!b || b.organizationId !== orgOf(actor)) throw new AppError("not_found");
  requirePermission(actor, "branches.manage", branchId);
  const org = orgOf(actor);
  const [own] = await db()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, org), eq(settings.key, "reception"), eq(settings.branchId, branchId)));
  const before = (own?.value ?? {}) as Record<string, unknown>;
  const after = { ...before, agentIssuing: "when_no_reception" };
  await putSetting(org, "reception", after as never, { branchId, userId: actor.auth.user.id });
  resetReceptionCache(branchId);
  await audit({
    ...auditMeta(actor),
    branchId,
    action: "setting.updated",
    entityType: "setting",
    entityId: "reception",
    before,
    after,
  });
  return { ok: true };
}
