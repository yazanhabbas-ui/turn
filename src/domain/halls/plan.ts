/**
 * Hall group planning (D62). Pure: which waiting visitors a host calls into the hall together.
 *
 * `waiting` must already be in queue order (effective priority first, then first come first served): the server
 * orders the tickets with the same ordering the desk queue uses and passes them here.
 */
export type HallWaiting = { id: string; reasonId: string };

export type GroupMode = "same_reason" | "any_reason";

export type HallBatchInput = {
  waiting: readonly HallWaiting[];
  /** Seats in the hall. */
  capacity: number;
  /** Smallest group worth opening a session for. */
  minGroup: number;
  /** Largest group; 0 = the capacity. */
  maxGroup: number;
  /** same_reason: one reason per session. any_reason: first come first served across reasons. */
  groupMode?: GroupMode;
  /** The reason of the group (a session that already has one, or the host's choice). */
  reasonId?: string | null;
  /** Reasons the hall accepts; null or empty = every waiting ticket. */
  acceptedReasonIds?: ReadonlySet<string> | readonly string[] | null;
  /** Visitors already called into the session (top-up): they count against capacity and the maximum. */
  occupied?: number;
  /** How many the host asks for; unset = as many as fit. */
  size?: number | null;
};

export type HallBatch = {
  ticketIds: string[];
  /** The reason of the group (same_reason mode); null when the groups are mixed or nobody is called. */
  reasonId: string | null;
  /** Visitors that could be called right now, before the host's `size`. */
  available: number;
  /** Why nobody was chosen. */
  shortfall: "none" | "empty" | "below_min" | "full";
};

/** How many more visitors the hall can take: capacity and the maximum group, less those already inside. */
export function seatsLeft(capacity: number, maxGroup: number, occupied = 0): number {
  const cap = maxGroup > 0 ? Math.min(capacity, maxGroup) : capacity;
  return Math.max(0, cap - Math.max(0, occupied));
}

const toSet = (v: HallBatchInput["acceptedReasonIds"]): Set<string> | null => (v && [...v].length ? new Set(v) : null);

export function planHallBatch(input: HallBatchInput): HallBatch {
  const occupied = Math.max(0, input.occupied ?? 0);
  const room = seatsLeft(Math.max(1, input.capacity), Math.max(0, input.maxGroup), occupied);
  const accepted = toSet(input.acceptedReasonIds);
  const eligible = input.waiting.filter((t) => !accepted || accepted.has(t.reasonId));
  const none = (shortfall: HallBatch["shortfall"], available = 0): HallBatch => ({
    ticketIds: [],
    reasonId: input.reasonId ?? null,
    available,
    shortfall,
  });
  if (room === 0) return none("full");
  if (!eligible.length) return none("empty");

  const mode = input.groupMode ?? "same_reason";
  // A top-up joins a session that already has people, so the minimum no longer applies.
  const min = occupied > 0 ? 1 : Math.max(1, Math.min(input.minGroup, room));
  const want = input.size && input.size > 0 ? Math.min(input.size, room) : room;

  let pool: HallWaiting[];
  let reasonId: string | null = null;
  if (mode === "same_reason") {
    if (input.reasonId) {
      pool = eligible.filter((t) => t.reasonId === input.reasonId);
      reasonId = input.reasonId;
    } else {
      // The reason at the head of the line goes first, unless it cannot fill the minimum: then the next reason that can.
      const order: string[] = [];
      for (const t of eligible) if (!order.includes(t.reasonId)) order.push(t.reasonId);
      const pick = order.find((r) => eligible.filter((t) => t.reasonId === r).length >= min) ?? order[0];
      pool = eligible.filter((t) => t.reasonId === pick);
      reasonId = pick;
    }
  } else {
    pool = eligible;
  }
  const available = Math.min(pool.length, room);
  if (!pool.length) return none("empty");
  if (available < min) return { ticketIds: [], reasonId, available, shortfall: "below_min" };
  const take = Math.min(available, want);
  return { ticketIds: pool.slice(0, take).map((t) => t.id), reasonId, available, shortfall: "none" };
}
