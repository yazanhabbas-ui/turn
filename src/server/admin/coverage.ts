import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, displays, settings } from "@/db/schema";
import { audit } from "../audit";
import { AppError } from "../http/errors";
import { agentIssuingState, resetReceptionCache } from "../queue/reception-status";
import { getSetting, putSetting } from "../settings/service";
import { auditMeta, orgOf, requirePermission, type Actor } from "./actor";
import { visibleBranchIds } from "./branches";

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
};

/**
 * Per branch the actor can see: how a visitor can get a ticket (D61). A city admin sees only their own city's
 * branches. Used by the badges on Cities and Branches and the "no way to issue tickets" card on the overview.
 */
export async function issuingCoverage(actor: Actor): Promise<BranchCoverage[]> {
  const org = orgOf(actor);
  const ids = await visibleBranchIds(actor, "admin.access");
  if (!ids.length) return [];
  const [rows, kioskRows] = await Promise.all([
    db()
      .select({ id: branches.id, cityId: branches.cityId, name: branches.name })
      .from(branches)
      .where(inArray(branches.id, ids)),
    db()
      .select({ branchId: displays.branchId, tokenHash: displays.tokenHash, revokedAt: displays.revokedAt })
      .from(displays)
      .where(and(inArray(displays.branchId, ids), eq(displays.kind, "kiosk"), isNull(displays.archivedAt))),
  ]);
  return Promise.all(
    rows.map(async (b) => {
      const [state, sc] = await Promise.all([agentIssuingState(org, b.id), getSetting(org, "selfCheckin", b.id)]);
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
