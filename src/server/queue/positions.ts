import { orderTickets } from "@/domain/distribution/ordering";
import type { BranchContext } from "./snapshot";

export type Position = { ahead: number; estimatedWaitMinutes: number; waitLow: number; waitHigh: number };

/** Position and estimated wait of every waiting ticket, computing each reason's order once. */
export function positionsFor(bctx: BranchContext): Map<string, Position> {
  const s = bctx.snapshot;
  const byReason = new Map<string, typeof s.tickets>();
  for (const t of s.tickets) {
    if (t.status !== "WAITING") continue;
    const list = byReason.get(t.reasonId) ?? [];
    list.push(t);
    byReason.set(t.reasonId, list);
  }
  const out = new Map<string, Position>();
  for (const [reasonId, list] of byReason) {
    const ordered = orderTickets(list, s.now, s.configFor, s.reasons, s.priorities);
    const agents = s.agents.filter((a) => a.skills.has(reasonId) && (a.status === "AVAILABLE" || a.status === "BUSY")).length;
    ordered.forEach((t, i) => {
      const e = bctx.waitFor(reasonId, i, agents);
      out.set(t.id, { ahead: i, estimatedWaitMinutes: e.minutes, waitLow: e.low, waitHigh: e.high });
    });
  }
  return out;
}
