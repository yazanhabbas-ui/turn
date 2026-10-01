import { splitTicket } from "../display/speech";

/**
 * How a group call is announced (D62): which tickets are read and in what shape.
 *  - list: every number is read ("A 14, A 15, A 16");
 *  - range: consecutive numbers of one prefix are read as a range ("A 14 to A 16");
 *  - hall_only: no numbers, only "the next group to hall 2".
 * More than `maxAnnounced` numbers fall back to ranges (and, if that is still too long, to "the next group").
 */
export type AnnounceMode = "list" | "range" | "hall_only";

export type AnnounceItem = { kind: "ticket"; displayNumber: string } | { kind: "range"; from: string; to: string; count: number };

export type GroupAnnouncement = { mode: "list" | "range" | "group_only"; items: AnnounceItem[]; total: number };

/** Groups tickets into runs of consecutive numbers with the same prefix (sorted by prefix, then number). */
export function consecutiveRuns(displayNumbers: readonly string[]): string[][] {
  const parsed = displayNumbers.map((d) => ({ d, ...splitTicket(d) }));
  const byPrefix = new Map<string, typeof parsed>();
  for (const p of parsed) byPrefix.set(p.prefix, [...(byPrefix.get(p.prefix) ?? []), p]);
  const runs: string[][] = [];
  for (const list of byPrefix.values()) {
    list.sort((a, b) => a.number - b.number);
    let run: typeof parsed = [];
    for (const p of list) {
      const prev = run[run.length - 1];
      if (prev && !Number.isNaN(p.number) && p.number === prev.number + 1) run.push(p);
      else {
        if (run.length) runs.push(run.map((x) => x.d));
        run = [p];
      }
    }
    if (run.length) runs.push(run.map((x) => x.d));
  }
  return runs;
}

export function planGroupAnnouncement(
  displayNumbers: readonly string[],
  mode: AnnounceMode,
  maxAnnounced: number,
): GroupAnnouncement {
  const total = displayNumbers.length;
  if (mode === "hall_only" || total === 0) return { mode: "group_only", items: [], total };
  const asList: AnnounceItem[] = displayNumbers.map((displayNumber) => ({ kind: "ticket", displayNumber }));
  // One visitor is always read by number.
  if (total === 1) return { mode: "list", items: asList, total };
  const limit = Math.max(1, maxAnnounced);
  if (mode === "list" && total <= limit) return { mode: "list", items: asList, total };
  const ranges: AnnounceItem[] = consecutiveRuns(displayNumbers).flatMap((run): AnnounceItem[] =>
    run.length >= 3
      ? [{ kind: "range", from: run[0], to: run[run.length - 1], count: run.length }]
      : run.map((displayNumber) => ({ kind: "ticket", displayNumber })),
  );
  if (ranges.length <= limit) return { mode: "range", items: ranges, total };
  return { mode: "group_only", items: [], total };
}
