/**
 * Fills the load database with completed tickets of earlier days (LOAD_HISTORY=<count>, spread over up to 300 days), so a
 * run measures a branch that has been in use for months and not an empty database. Every hot query that scans history
 * instead of using an index shows up here. Rows are plain SQL inserts: tickets, and four events each (ISSUED, CALLED,
 * STARTED, COMPLETED). Only for the throw-away load database.
 */
import { Client } from "pg";

export async function seedHistory(databaseUrl: string, count: number, opts: { assigned: boolean }) {
  if (!/_load$/.test(new URL(databaseUrl).pathname))
    throw new Error("history is only written to a database whose name ends in _load");
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const branch = (await pg.query("select id, organization_id from branches where is_default limit 1")).rows[0];
    const agents = (
      await pg.query("select user_id from agent_profiles where branch_id = $1 order by user_id", [branch.id])
    ).rows.map((r) => r.user_id as string);
    const queues = (
      await pg.query(
        `select q.id, q.reason_id, r.prefix from queues q join visit_reasons r on r.id = q.reason_id
         where q.branch_id = $1 and r.code in ('general','documents','complaint') order by r.code`,
        [branch.id],
      )
    ).rows as { id: string; reason_id: string; prefix: string }[];
    if (queues.length !== 3 || !agents.length) throw new Error("history needs the provisioned agents and the three reasons");
    const p = [
      branch.organization_id,
      branch.id,
      ...queues.map((q) => q.id),
      ...queues.map((q) => q.reason_id),
      ...queues.map((q) => q.prefix),
      agents,
      agents.length,
      count,
    ];
    await pg.query(
      `insert into tickets (organization_id, branch_id, queue_id, reason_id, prefix, number, display_number, service_day, status, language,
                            public_token, serving_agent_id, assigned_agent_id, arrived_at, queued_at, called_at, started_at, finished_at,
                            outcome, source, idempotency_key, version)
       select $1, $2, (array[$3,$4,$5]::uuid[])[(k % 3) + 1], (array[$6,$7,$8]::uuid[])[(k % 3) + 1], (array[$9,$10,$11])[(k % 3) + 1],
              (k / 3) + 1, (array[$9,$10,$11])[(k % 3) + 1] || '-' || lpad(((k / 3) + 1)::text, 3, '0'), (current_date - (d + 3))::date,
              'COMPLETED', 'ar', md5(random()::text || g::text) || md5(g::text), ($12::uuid[])[(g % $13) + 1],
              ${opts.assigned ? "($12::uuid[])[(g % $13) + 1]" : "null"},
              ts, ts, ts + interval '5 minutes', ts + interval '6 minutes', ts + interval '14 minutes', 'resolved', 'reception',
              'hist-' || g, 3
       from (select g, g % 300 as d, g / 300 as k,
                    (current_date - (g % 300 + 3))::timestamp + interval '9 hours' + ((g / 300) % 400) * interval '1 minute' as ts
             from generate_series(1, $14::int) g) s`,
      p,
    );
    await pg.query(
      `insert into ticket_events (organization_id, branch_id, ticket_id, type, actor_type, agent_id, queue_id, payload, at)
       select t.organization_id, t.branch_id, t.id, e.type, 'user', t.serving_agent_id, t.queue_id, '{}'::jsonb, e.at
       from tickets t cross join lateral (values ('ISSUED', t.arrived_at), ('CALLED', t.called_at), ('STARTED', t.started_at),
                                                 ('COMPLETED', t.finished_at)) as e(type, at)
       where t.idempotency_key like 'hist-%'`,
    );
    await pg.query("analyze tickets");
    await pg.query("analyze ticket_events");
  } finally {
    await pg.end();
  }
}
