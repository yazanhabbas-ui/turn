/**
 * Queue correctness checks after a run. They read the database directly (the system of record) and compare it with what
 * the simulated clients saw. A load test that is fast but loses or duplicates a ticket has failed.
 */
import { Client as Pg } from "pg";
import type { RunLog } from "./scenario";

export type Check = { name: string; ok: boolean; detail: string };

export async function checkInvariants(opts: {
  databaseUrl: string;
  log: RunLog;
  drained: boolean;
  since: string;
  issueFailures: number;
}): Promise<Check[]> {
  const { log, drained, since, issueFailures } = opts;
  const pg = new Pg({ connectionString: opts.databaseUrl });
  await pg.connect();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  try {
    const issuedIds = log.issued.map((t) => t.id);

    // 1. No lost tickets: every ticket the clients were given exists, and nothing else does.
    const total = Number((await pg.query("select count(*)::int as n from tickets where arrived_at >= $1", [since])).rows[0].n);
    const found = Number(
      (await pg.query("select count(*)::int as n from tickets where id = any($1::uuid[])", [issuedIds])).rows[0].n,
    );
    add(
      "no lost tickets",
      found === issuedIds.length && total >= issuedIds.length && total - issuedIds.length <= issueFailures,
      `issued ${issuedIds.length}, found ${found}, rows in tickets ${total} (${issueFailures} issue requests failed or timed out on the client side and may still have been created)`,
    );

    // 2. No ticket handed to two agents (clients' view and the event log).
    const handedTwice = [...log.calledBy.entries()].filter(([, a]) => a.length > 1).length;
    const dbTwice = (
      await pg.query(
        `select ticket_id from ticket_events where type = 'CALLED' and at >= $1 group by ticket_id having count(*) > 1 or count(distinct agent_id) > 1`,
        [since],
      )
    ).rowCount;
    add(
      "no ticket assigned to two agents",
      handedTwice === 0 && dbTwice === 0 && log.violations.length === 0,
      `handed twice (clients) ${handedTwice}, CALLED events repeated (database) ${dbTwice}, agents handed a second ticket while busy ${log.violations.length}${log.violations[0] ? ` e.g. ${log.violations[0]}` : ""}`,
    );

    // 3. No agent ever served more than one visitor at a time (max concurrent is 1 for these agents).
    const events = (
      await pg.query(
        `select agent_id, type, at from ticket_events where agent_id is not null and at >= $1 and type in ('CALLED','COMPLETED','NO_SHOW','CANCELLED','TRANSFERRED','HELD') order by at, id`,
        [since],
      )
    ).rows as { agent_id: string; type: string; at: Date }[];
    const open = new Map<string, number>();
    let worst = 0;
    for (const e of events) {
      const n = (open.get(e.agent_id) ?? 0) + (e.type === "CALLED" ? 1 : -1);
      open.set(e.agent_id, Math.max(0, n));
      worst = Math.max(worst, n);
    }
    add(
      "no agent served two visitors at once",
      worst <= 1,
      `highest number of visitors held by one agent at the same time: ${worst}`,
    );

    // 4. Numbering: unique and gap-free per branch, service day and prefix.
    const numbering = (
      await pg.query(
        `select prefix, service_day::text as day, count(*)::int as n, min(number)::int as lo, max(number)::int as hi, count(distinct number)::int as d
         from tickets where arrived_at >= $1 group by branch_id, service_day, prefix order by 2, 1`,
        [since],
      )
    ).rows as { prefix: string; day: string; n: number; lo: number; hi: number; d: number }[];
    const broken = numbering.filter((r) => r.lo !== 1 || r.hi !== r.n || r.d !== r.n);
    add(
      "ticket numbers unique and gap-free",
      broken.length === 0,
      numbering
        .map((r) => `${r.prefix} ${r.day}: ${r.n} tickets, numbers ${r.lo}-${r.hi}${r.d !== r.n ? " DUPLICATES" : ""}`)
        .join("; ") || "no tickets",
    );

    // 5. Counts: after the drain every ticket is completed, once, and matches what the agents reported.
    const byStatus = Object.fromEntries(
      (
        await pg.query("select status::text as s, count(*)::int as n from tickets where arrived_at >= $1 group by 1", [since])
      ).rows.map((r: { s: string; n: number }) => [r.s, r.n]),
    ) as Record<string, number>;
    const completed = byStatus.COMPLETED ?? 0;
    add(
      drained ? "all tickets completed" : "tickets completed (queue was not fully drained in the time allowed)",
      drained ? completed === issuedIds.length && log.completed.size === completed : completed === log.completed.size,
      `database ${JSON.stringify(byStatus)}, completed by agents ${log.completed.size}, issued ${issuedIds.length}`,
    );
    const eventCounts = (
      await pg.query(
        `select (select count(*)::int from ticket_events where type='ISSUED' and at >= $1) as issued,
                (select count(*)::int from ticket_events where type='STARTED' and at >= $1) as started,
                (select count(*)::int from ticket_events where type='COMPLETED' and at >= $1) as completed`,
        [since],
      )
    ).rows[0] as { issued: number; started: number; completed: number };
    add(
      "event log matches the tickets",
      eventCounts.issued === total && eventCounts.completed === completed && eventCounts.started >= completed,
      `ISSUED ${eventCounts.issued} (tickets ${total}), STARTED ${eventCounts.started}, COMPLETED ${eventCounts.completed} (completed tickets ${completed})`,
    );

    // 6. Notifications: the worker with the mock provider settles every row (nothing stuck, nothing failed).
    let notes: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      notes = Object.fromEntries(
        (await pg.query("select status, count(*)::int as n from notifications_log group by 1")).rows.map(
          (r: { status: string; n: number }) => [r.status, r.n],
        ),
      );
      if (!(notes.queued || notes.sending)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const stuck = (notes.queued ?? 0) + (notes.sending ?? 0);
    const dup = (
      await pg.query(
        "select count(*)::int as n from (select dedupe_key from notifications_log where dedupe_key is not null group by 1 having count(*) > 1) x",
      )
    ).rows[0].n;
    add(
      "notifications settled",
      stuck === 0 && !notes.failed && dup === 0,
      `notifications_log ${JSON.stringify(notes)}, duplicate dedupe keys ${dup}`,
    );
  } finally {
    await pg.end();
  }
  return checks;
}
