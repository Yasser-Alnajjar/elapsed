# Custom REST: recovering from a deletion-guard abort

Status: **pilot procedure** (owner decision OD-01 / U2, option (b), 2026-10-10). It covers the Beta pilot only. Option (a), a reviewed workflow that lets an owner or operator apply or reverse a mass deletion, must be reconsidered before general availability (plan 09 §15.1, `docs/validation/server-validation-master.md` §2.5).

## Scope and rules

- Applies when a custom integration's latest sync run is `aborted` with reason `mass_deletion`: more live tickets were reported deleted in one pass than `max(3, 5% of live cases)` (plan 09 §6.4).
- The abort writes nothing. Existing cases and events stay visible and monitored. The source goes stale (breach alerts are held) until the abort clears.
- **Never delete `RawEvent` rows** (append-only replay log, plan 09 §7), never edit `Case.deletedAt` or `NormalizedEvent` by hand to get a sync through, and never lower or bypass a guard. The override machinery covers only the lifecycle guard (R2) and is not used here.
- Everything below is read-only SQL plus a source-side fix, a pause, or an escalation. A step that would change stored data is an engineering escalation, not an operator action (see "What this procedure cannot do").

Run the SQL in `psql` with the ids set first (for example `\set integration_id 'cm...'` and `\set ids '{T-1,T-2}'`, using `ANY (:'ids'::text[])`); the statements are read-only.

## 1. Confirm the abort and read the numbers

```sql
-- Latest run for the integration (replace the id). Read-only.
SELECT "startedAt", outcome, "reasonCode", progress
FROM integration_sync_runs
WHERE "integrationId" = :integration_id
ORDER BY "startedAt" DESC
LIMIT 3;
```

`progress` holds the guard counts (`L` live cases, `B` tickets attempted, `F` failed, `D` deleted and still live, `R` lifecycle flips, `N` new, `C` ceiling) and up to 20 ticket ids (`recordIds`). The statements below are exercised against a real database by `packages/custom-ticket/test/ingest-runs.db.test.ts`. The customer sees the specific message in the integration banner (`mass_deletion`).

## 2. Find out which kind of deletion signal fired

| Kind | What it is | Self-clearing? |
| --- | --- | --- |
| **(i) Status or flag signal** | The mapped `deletion.statusValues` / `deletion.flagPath` matched in the ticket's **latest snapshot** | **Yes.** Restoring the ticket at the source creates a newer snapshot without the signal; the next pass clears the abort |
| **(ii) Verified-404 marker** | `deletion.verifyWithDetail` fetched the ticket detail and got 404; a `ticket_deleted:{id}:{hash}` raw event was written | **No.** The marker is permanent in V1 (raw events are append-only; the projector never clears `deletedAt`). Restoring the ticket at the source does not clear it |

```sql
-- Which of the listed ids have a permanent marker? (Read-only; ids from step 1.)
SELECT substring("providerEventId" FROM '^ticket_deleted:(.*):[0-9a-f]+$') AS ticket_id, "fetchedAt"
FROM raw_events
WHERE "integrationId" = :integration_id
  AND "providerEventId" LIKE 'ticket_deleted:%'
  AND substring("providerEventId" FROM '^ticket_deleted:(.*):[0-9a-f]+$') = ANY (:'ids'::text[])
ORDER BY "fetchedAt" DESC;
```

An id with a marker is kind (ii). An id without one is kind (i).

## 3. Act

1. **All kind (i):** ask the customer to check the deletion status/flag at their source. If the mass deletion was a mistake, they restore the tickets; the next sync (within the poll interval) clears the abort on its own. If it was intended, see "What this procedure cannot do".
2. **Any kind (ii):** the marker stays. Do not touch raw events. Decide with the customer whether the tickets are truly gone at the source.
   - Truly gone and few enough to be under the threshold: nothing to do; the guard passes once `D` is back under `max(3, 5% of L)`.
   - Gone but over the threshold, or wrongly marked (a transient 404 that later recovered): escalate (below).
3. **While waiting:** an operator can pause polling for the integration (**Pause polling** on `/admin/tenants/<id>`; **Resume polling** undoes it; no data change) or the customer can disconnect it (soft; data kept). Removing the organization from the Custom REST allowlist also pauses polling and is not undone by re-adding it (`docs/integration-availability.md`). Tell the customer the dashboard shows data up to the last good sync and that alerts for this source are held.
4. **Record** the case in the support ticket: integration id, run timestamps, `D`, `L`, ids, kind (i)/(ii), who decided what.

## What this procedure cannot do (documented gap)

- It cannot apply a legitimate mass deletion. The guard blocks it and there is no override for it (R2).
- It cannot undo a verified-404 marker. There is no undelete in V1.
- Both need a reviewed engineering action (an audited, narrowly scoped operator workflow, i.e. small option-(a) work). **That action does not exist yet.** Until it does, an escalation is answered by engineering on a case-by-case basis and the outcome is recorded here and in the validation master.

## Pilot rules that keep the gap small

- Configure pilots with a deletion **status or flag** signal and without `deletion.verifyWithDetail`; kind (i) is self-clearing. The operator checks this when enabling an organization on the Beta allowlist.
- Pilot organizations are told in writing (setup guidance) that a large deletion pauses syncing until fixed at the source, and that a verified-404 marker is permanent.
