/**
 * H-4 (read-only): replays case_created.actor for tickets using only the audits present at first ingest vs all audits.
 * Usage: dotenv -e ../../.env -- tsx h4/creation-actor-replay.mts <ticketId>...
 */
import pg from "pg";
import { deriveNormalizedEventsForTicket } from "../../zendesk/src/normalize";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const roles = new Map<number, any>();
for (const r of (await db.query(`select payload from raw_events where "providerEventId" like 'user:%'`)).rows) roles.set(r.payload.id, r.payload.role);
for (const tid of process.argv.slice(2)) {
  const ticket = (await db.query(`select payload from raw_events where "providerEventId" like $1 order by "fetchedAt" desc limit 1`, [`ticket:${tid}:%`])).rows[0].payload;
  const audits = (await db.query(`select id,"fetchedAt",payload from raw_events where "providerEventId" like 'ticket_audit:%' and payload->>'ticket_id'=$1 order by payload->>'created_at'`, [tid])).rows;
  const all = audits.map((a) => ({ rawEventId: a.id, audit: a.payload }));
  // audits available at the first ingest (the fetch batch that first wrote any audit for this ticket)
  const firstFetch = audits[0].fetchedAt;
  const early = audits.filter((a) => a.fetchedAt <= new Date(+firstFetch + 5000)).map((a) => ({ rawEventId: a.id, audit: a.payload }));
  const ce = (aud: any) => deriveNormalizedEventsForTicket(ticket, aud, "x", roles).find((e) => e.type === "case_created")!.actor;
  console.log(`#${tid} requester=${roles.get(ticket.requester_id)} submitter=${roles.get(ticket.submitter_id)} case_created.actor: first-ingest audits(${early.length})=${ce(early)}  all audits(${all.length})=${ce(all)}`);
}
await db.end();
