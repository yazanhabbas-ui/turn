import { io } from "../realtime";

/**
 * Realtime events. Published only after the transaction commits, so clients never see state that could
 * still roll back. Clients treat `queue.updated` as "refetch the queue state"; `ticket.called` drives the
 * display screen announcement.
 */
export type QueueEvent =
  | { type: "queue.updated"; branchId: string; cause: string; ticketId?: string }
  | {
      type: "ticket.called";
      branchId: string;
      ticketId: string;
      displayNumber: string;
      /** Last digits of the visitor's phone; when set, screens and the voice call it instead of the ticket number. */
      callCode?: string | null;
      deskId: string | null;
      deskNumber: string | null;
      agentId: string;
      reasonId: string;
      language: string;
      recall: boolean;
      /** Set when the visitor is called to a hall (D62): the screens announce the group with `hall.called`, not each ticket. */
      hallId?: string | null;
      hallNumber?: string | null;
    }
  | {
      /** One grouped call to a hall (D62): every ticket of the group, announced together. */
      type: "hall.called";
      branchId: string;
      hallId: string;
      hallNumber: string;
      hallName: Record<string, string>;
      sessionId: string;
      agentId: string;
      tickets: { ticketId: string; displayNumber: string; reasonId: string; language: string }[];
      recall: boolean;
    }
  | { type: "agent.updated"; branchId: string; agentId: string; status: string }
  | {
      type: "break.update";
      branchId: string;
      agentId: string;
      /** queued = the break limit is reached and the agent is in line; available = a place is theirs for a while. */
      kind: "queued" | "available" | "expired" | "cancelled";
      onBreak?: number;
      limit?: number;
      position?: number;
      expiresAt?: string;
      holdMinutes?: number;
    }
  | { type: "alert.raised"; branchId: string; alertType: string; payload: Record<string, unknown> };

export function publish(events: QueueEvent[]) {
  const hub = io();
  if (!hub || !events.length) return;
  // Coalesce repeated queue.updated per branch into one message.
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type === "queue.updated") {
      if (seen.has(e.branchId)) continue;
      seen.add(e.branchId);
    }
    // Break-line news is for the agent it concerns.
    if (e.type === "break.update") {
      hub.to(`user:${e.agentId}`).emit(e.type, e);
      continue;
    }
    hub.to(`branch:${e.branchId}`).emit(e.type, e);
    // Waiting-room screens only get what they render: queue changes and calls (never agent status or alerts).
    if (e.type === "queue.updated") hub.to(`screens:${e.branchId}`).emit(e.type, e);
    if (e.type === "hall.called") {
      const forScreens: Omit<typeof e, "agentId"> & { agentId?: string } = { ...e };
      delete forScreens.agentId;
      hub.to(`screens:${e.branchId}`).emit(e.type, forScreens);
    }
    if (e.type === "ticket.called") {
      const forScreens: Omit<typeof e, "agentId"> & { agentId?: string } = { ...e };
      delete forScreens.agentId;
      hub.to(`screens:${e.branchId}`).emit(e.type, forScreens);
    }
    if (e.type === "ticket.called" || e.type === "agent.updated") hub.to(`user:${e.agentId}`).emit(e.type, e);
  }
}
