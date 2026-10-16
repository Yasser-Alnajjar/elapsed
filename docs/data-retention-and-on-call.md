# Data retention, deletion and on-call

Roadmap task **H-5** (was 7.11). Audit and documentation only: nothing here
was built or changed in code. Audited against the repository on 2026-09-29.

**Update 2026-10-10 (D34, final).** `RawEvent` rows, raw snapshots
included, have **no age-based expiry**. They are kept for the lifetime of
their organization and deleted only by the supported organization-deletion
procedure (`packages/db/src/scripts/delete-organization.ts`, see "Deleting an
organization"). This replaces a 365-day policy recorded earlier the same
day, which was never implemented. See
[RawEvent retention (D34)](#rawevent-retention-d34).

## What is kept, and for how long

| Data | Retention today | Basis |
| --- | --- | --- |
| `RawEvent` (provider payloads, append-only, for replay) | No age-based expiry (D34). Kept for the lifetime of the organization; deleted only by the organization-deletion procedure. No prune, purge or archive job exists in `apps/` or `packages/`, by design. Disconnect deletes none. | Verified (code and schema); policy: Decision (approved) |
| `NormalizedEvent` | No expiry. Rows are reconciled when a case is re-normalized: the shared projector (`packages/ingestion/src/projector.ts`, `diffNormalizedEvents`) keeps unchanged events and deletes only the stored events a fresh derivation no longer produces. It is derived data, not an audit log. Like the raw events it is derived from, it is kept until the organization is deleted. _(Corrected 2026-10-09: this row used to say the provider `normalize.ts` files call `deleteMany`; they no longer do, since N2 moved all writes into the projector.)_ | Verified |
| `Evaluation`, `Commitment`, `LegSpan`, `Notification` | No expiry. | Verified |
| `Case`, `Customer`, policies, calendars | Kept until the organization is removed. | Verified |
| `PasswordResetToken`, `EmailVerificationToken` | Rows are not deleted on use or expiry. Only unused tokens for the same user are removed when a new one is issued. They go with the user. | Verified |
| `OrganizationInvitation` | No expiry cleanup found. | Verified |
| Sign-in sessions | Signed JWTs, not database rows. `User.sessionVersion` revokes them. Nothing is stored server-side. | Verified |
| Container logs | No `logging:` options in any compose file in the repo, so Docker's default applies. No rotation is configured by the repo. | Verified for the repo; host `daemon.json` **not verified** |
| Database dumps | `scripts/backup.sh` deletes dumps older than `RETENTION_DAYS` (default 14) after a successful, readable dump. Off-site copies are only made if `OFFSITE_COPY_CMD` is set, and their retention is set on the bucket. | Script verified; whether cron and off-site copy are actually installed on the host **not verified** |
| Deleted organizations in backups | Deleting an organization from the live database does not remove it from dumps already taken. Local dumps age out after `RETENTION_DAYS`; off-site copies follow the bucket's own policy. Restoring a dump taken before the deletion brings the organization and all its data back; run the deletion procedure for it again. Its `delete_organization` audit row is not in that older dump, so keep a record of deletions outside the database (the procedure's JSON report). | Script verified; off-site retention **not verified** |

There is no per-plan retention window in the schema or code, and D34 is the
same for every provider and plan. The
"90-day case history" and "custom data retention" pricing claims were removed
under H-3 for this reason.

## Secrets at rest

- Integration OAuth access and refresh tokens, including Slack's bot token,
  are encrypted (`enc:v1:` AES-GCM, `INTEGRATION_TOKEN_ENCRYPTION_KEY`).
  Verified in `packages/db/src/integration-credentials.ts` and the Slack
  callback route.
- Each organization's OAuth client secrets (`IntegrationConfig`) and SMTP
  password are encrypted with their own keys. Verified in
  `packages/db/src/integration-config.ts` and `email-settings.ts`.
- Rows written before token encryption existed are converted by
  `pnpm db:encrypt-tokens`. Whether that has been run on production is
  **not verified**.

## Deletion

**Disconnecting an integration**
- Zendesk, Jira, Linear, Intercom and GitHub: soft disconnect. `credentials`
  is set to null, `status` to `disconnected`, `disconnectedAt` is set. The
  integration row, `webhookSecret`, `cursor`, and every raw event, case and
  evaluation stay. Verified in each `disconnect/route.ts`.
- Slack: the `SlackIntegration` row, including the stored token, is hard
  deleted. Verified.
- Custom REST (`custom`): the same soft disconnect, and its configuration
  versions and `activeConfigVersion` are kept so the owner can reconnect on
  the last activated version. **Delete configuration** (a separate owner action,
  disconnected sources only) deletes only the draft and the configuration
  versions. The integration row and every raw event, case, event, commitment
  and evaluation stay; it is not a purge and changes no retention rule above.
  N9 design record §7 ("Reconnect" and "Delete configuration") in `implementation-plans/ROADMAP_Product.md`.
- No provider-side token revocation is called; only local credentials are
  cleared. Stated in the Zendesk route, and none of the other disconnect
  routes call a revoke endpoint either. The customer should revoke the app in
  the provider if they want the grant gone.
- The organization's OAuth app config (`IntegrationConfig`) is not cleared by
  a disconnect. Verified: no disconnect route touches it.

**Removing a team member**: `removeMember` deletes the `User` row
(`packages/db/src/members.ts`); their tokens go with it (cascade). Verified.

**Deleting an organization**: the supported procedure is the operator script
`packages/db/src/scripts/delete-organization.ts` (logic in
`packages/db/src/organization-deletion.ts`), added 2026-10-10. There is no
application UI or API for it, by design. Do not delete an organization with
hand-written SQL.

What the procedure does, in order:

1. **Identifies the target.** It needs `--organization-id` (no default, one
   id only), `--database` (must equal `current_database()`, so a wrong
   `DATABASE_URL` is refused), and, to delete, `--confirm-name` (the exact
   organization name), `--actor` (operator email for the audit rows) and
   `--execute`. Without `--execute` it is a dry run that prints the
   organization, its integrations and its row counts, and changes nothing.
2. **Pauses polling** on the organization's integrations that are not
   already paused or disconnected (`Integration.pollingPausedAt`, the admin
   console's `pause_polling`, with one `pause_polling` audit row each), so no
   new provider fetch starts.
3. **Takes the organization's worker lease** (`organization_work_states`),
   using the same rule a worker uses to claim it. If a worker cycle is
   running, it waits for the cycle to finish (default 10 minutes, then it
   gives up). While the procedure holds the lease, no worker claims the
   organization. The fencing token is incremented, so a worker whose lease
   had already expired can no longer renew or complete.
4. **Deletes in one transaction.** It takes the `sla-processing`
   advisory lock that every projection and pipeline writer takes (the
   worker, Zendesk/Jira webhooks, web backfills), waiting up to 15 minutes.
   It then re-checks its lease and the organization name, writes one
   `delete_organization` audit row, runs `DELETE FROM organizations WHERE
   id = …`, checks that no row with that `organizationId` and no raw event
   of its integrations is left, and commits. The cascade handles every
   tenant table. The four in-tenant `ON DELETE RESTRICT` keys are satisfied
   because the referencing rows go in the same statement; no foreign key was
   changed.
5. **Reports** one JSON document: status, counts by table (including
   `raw_events.ticket_snapshots`), and manual follow-ups. It logs no
   credentials or payloads.

Failure and retry: anything that fails before the commit (lease wait,
advisory-lock timeout, statement timeout, a failed check) rolls back.
Nothing is deleted, no `delete_organization` row is written, and the lease
is released. The integrations the run paused **stay paused** and are listed;
re-run the same command, or resume them in the admin console if the deletion
is abandoned. A re-run pauses nothing twice. After a successful delete, a
re-run reports `already_deleted`. **The commit is irreversible**; the only
way back is restoring a backup.

Concurrency, and what it does not cover:

- Raw ingestion does not take the advisory lock. This covers webhook
  `RawEvent` inserts and the provider fetch inside a web-triggered backfill.
  Foreign keys keep it safe: an insert that commits before the delete is
  removed by the cascade, and one after it fails on the missing integration.
  No row of the deleted organization can be recreated: every tenant table
  has a foreign key to the organization or to one of its rows.
- Webhooks (audited 2026-10-10 by driving the real Zendesk route on a
  disposable database):
  - A delivery after the deletion gets `404 Unknown webhook endpoint` and
    stores nothing.
  - A delivery in flight when the deletion commits fails inside the route's
    own bookkeeping (`integration.update`, Prisma `P2025`). Next.js answers
    500, and an error is logged.
  - In both cases nothing is stored. A provider retry lands on the 404.

  Dropping these events is the intended outcome: the organization's data must
  not be kept. The Jira route has the same structure (read, not run).
- If the deletion **fails** and rolls back, nothing is lost:
  - a webhook's raw event is stored before it waits for the advisory lock,
    and is projected after the lock is released, or by the next worker pass;
  - paused polling only skips provider fetches, so normalization of stored
    events continues;
  - after resuming, the incremental cursor fetches what changed in the
    meantime.

  Provider-side retry policies were not verified and are not relied on.
- Sessions: every request that reads tenant data goes through
  `getServerSession`. That runs the `jwt` callback, which re-reads the
  `User` row (`assertSessionStillValid`), and next-auth clears the session
  when it throws. The users are deleted with the organization, so an existing
  JWT is rejected on its next request (verified with the real callback after
  a deletion: `SessionInvalidatedError`). The proxy (`apps/web/src/proxy.ts`)
  only checks that a token decodes, so a deleted user can still reach a page
  shell or a 401 from an API route, but no tenant data. An open `/api/live`
  stream stays open until the client disconnects; it carries only
  `{type, organizationId}` notifications, and none are published for a
  deleted organization.
- Tested on a disposable database (below), not on production-sized data or
  with a live worker fleet. A very large organization is deleted in one
  transaction; `--statement-timeout-ms` (default 30 minutes) bounds it, and
  only that organization's rows are locked.

Runbook (production host). The worker image contains the repository,
`tsx` and Node 22, and the host has no Node of its own. The command was
verified inside an image built from `apps/worker/Dockerfile` on 2026-10-10,
against a disposable database: refusals, dry run, execute (exit 0) and
re-run (`already_deleted`).

Preconditions:

1. The deployed worker image includes `packages/db/src/scripts/delete-organization.ts`.
   This needs a deployment of this change; the next `docker compose ... build worker`
   picks it up.
2. A verified backup taken just before (the only undo).
3. One rehearsal on a restore of a production backup, into a scratch
   database whose name contains "test", using the same commands with that
   database's `--database`. Record the duration and the report.
4. The compose file and env file the host really uses. The repo documents
   `docker compose -f docker-compose.yml --env-file .env.prod`; other docs
   mention a `docker-compose.prod.yml` that is not in the repo (see "On-call
   note").
5. `--database` must match the database in that env file's `DATABASE_URL`.
   For production this has been `elapsed_db`, not the compose default
   `POSTGRES_DB`. The script refuses any mismatch.
6. The organization id and exact name, confirmed with the customer's request.

```sh
# 0. Backup (the only undo).
DB_NAME=elapsed_db scripts/backup.sh
# 1. Dry run: read the name, integrations and counts.
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -w /repo/packages/db worker \
  npx tsx src/scripts/delete-organization.ts --organization-id=<id> --database=elapsed_db
# 2. Delete.
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -w /repo/packages/db worker \
  npx tsx src/scripts/delete-organization.ts --organization-id=<id> --database=elapsed_db \
  --confirm-name="<exact name from step 1>" --actor=<operator email> --execute
```

Keep the JSON report from step 2 outside the database. Exit 0 means a dry
run, a deletion or `already_deleted`; exit 1 means refused, not found or
failed, and nothing was deleted.

Verified 2026-10-10 on disposable databases only (never `elapsed_db` or
`sla_test`); details in [RawEvent retention (D34)](#rawevent-retention-d34).

_History (H-5, 2026-09-29 to 2026-10-03):_ hand-run `DELETE FROM
organizations` on the 5,000-case perf seed removed everything, but did not
finish in 17 minutes without an index on
`normalized_events.sourceRawEventId`. Migration
`20261003120000_normalized_event_source_raw_event_index` added it: 1.4 s
for two 2,000-case organizations, against more than 120 s without it. The
index stays; the procedure depends on it.

**Audit history (`admin_audit_logs`) is kept after an organization is
deleted.** This is deliberate. The table is the platform's record of what
operators did (N4.2). It has no foreign key to `organizations` so that a row
survives what it describes, has no tenant read path, and has no update or
delete path in code (`admin-boundary.test.ts`). The deletion writes its own
`delete_organization` row. Retained rows hold the operator's email, the
organization and integration ids, the action and its metadata:

- provider names;
- plan and billing-record values for `update_plan` and `billing_override`,
  including a billing reference if one was entered;
- availability reasons;
- for `delete_organization`, the row counts, providers and the
  organization's creation time. The name is deliberately left out.

No row holds a credential, a token or a provider payload. They are
distinguished from live tenant data by being in this one platform table,
whose `organizationId` matches no organization. They are kept indefinitely,
and nothing deletes them. Whether a deletion request must also remove or
redact them is a **legal question, not decided**. It is not yet on the
reviewer's list in the roadmap's N9 legal-review gate, which stays under the
owner's hold.

**Backups** keep deleted data until they age out (see the table above).

## RawEvent retention (D34)

**Final owner decision, 2026-10-10**, recorded as decision D34 in
`implementation-plans/ROADMAP_Product.md` (Rev 19). It replaces a 365-day
policy recorded earlier that day, which was never built. The Privacy
wording that describes it is a separate decision, O-1 (validation ledger
§2.4), and still waits for the qualified legal reviewer.

- `RawEvent` rows, including every provider's raw snapshots and Custom REST
  snapshots (latest and superseded), **do not expire by age**. They are kept
  for the lifetime of the organization that owns them.
- They are deleted only by the organization-deletion procedure (see
  "Deleting an organization" above), under its foreign-key constraints and
  tenant isolation. There is no retention job, scheduled prune or age limit,
  and none is to be built.
- Disconnecting an integration deletes nothing (unchanged).
- Backup retention is unchanged. Deleting an organization from the live
  database is not deletion from backups (see the table above).

**Verification, 2026-10-10, disposable databases only.**

- *Cascade alone*, before the procedure existed: `DELETE FROM organizations`
  on two Zendesk-shaped and two Custom REST organizations removed every row
  of the target and left the neighbour identical.
- *The procedure*, `organization-deletion.ts`: 36 of 36 checks passed on a
  fresh database with every migration applied (through
  `20261009120000_n10_integration_availability`). Seed:
  - two Zendesk-shaped organizations (perf seed: 300 cases, 20 events per
    case, commitments and evaluations);
  - two Custom REST organizations (150 tickets each) projected by the real
    worker reconciliation pass, then given a second snapshot per ticket, so
    each had latest and superseded snapshots (300 `ticket:` rows) and
    normalized events citing them.

  Checked:
  - Refusals: empty id, wrong database name, missing or wrong
    `--confirm-name` (including another organization's name), missing actor.
    A dry run changed nothing. An unknown id reports `not_found`.
  - A worker holding the lease: the deletion waited, then failed with
    nothing deleted and the worker's lease untouched. Polling was paused and
    audited once, and reported as a follow-up.
  - A projection holding the advisory lock: the deletion failed on the lock
    timeout and rolled back. Its lease was released, and a re-run paused
    nothing twice.
  - A failure injected just before the `DELETE`: full rollback, no
    `delete_organization` row.
  - The retry deleted the organization. A worker claim attempted during the
    delete skipped it while claiming the others. A raw event inserted during
    the delete was removed by the cascade; one inserted after it failed on
    the foreign key. A second re-run reported `already_deleted`.
  - Every table of the deleted Custom REST and Zendesk-shaped organizations
    was empty: raw events, latest and superseded snapshots, normalized events,
    cases, commitments, evaluations, policy and calendar versions, customers,
    configuration versions and integrations. Exactly one
    `delete_organization` row exists, holding counts and providers.
  - The two neighbours' fingerprints were identical before and after: counts
    plus a hash over the ids and key fields of raw events, normalized events,
    cases and commitments.
  - No orphan anywhere: raw event without its integration, normalized event
    without its raw event or case, commitment without its case, customer
    identity without its customer, work state without its organization. No
    normalized event cited another organization's raw event.

  Not covered: production-sized data, a real multi-process worker fleet
  (the lease and lock behavior was driven from the test), and session
  revocation for deleted users.

**Growth, cost and backups under D34.** Raw events now accumulate for as
long as an organization exists.

- Database size and backups grow with them. Every snapshot change adds a
  row (Custom REST up to 64 KB each; N9 design record §6.9), and dumps and restores
  grow and slow down accordingly.
- Custom REST normalization reads every stored snapshot of the integration
  on each full pass, so its read cost grows with history, not with live
  cases (N9 design record §6.9). The live-case ceiling (the provisional
  Beta ceiling of 1,000, OD-08) does not bound it.

What already measures this:

- `scripts/restore-drill.sh` appends dump size and `restore_seconds` to
  `docs/restore-drills.log` on the host.
- N8-S6 is the roadmap trigger to act (scale item S6): backup or restore
  over 30 minutes, or regressions in analytics query p95. That is a planning
  trigger, not a configured production alert.
- The admin billing page counts raw events ingested per organization over a
  period (`admin-billing-data.ts`, by `fetchedAt`).

There is no alert on table size. Partitioning or archiving (N8-S6) is the
future response. Any archive must keep raw events readable for replay and
must still be removed by organization deletion. Neither is built, and
neither is needed at today's size.

## Decisions (owner) — not built

1. ~~A retention period for `RawEvent`~~ **Decided 2026-10-10 (D34):** no
   age-based expiry; deleted only by the organization-deletion procedure. See
   [RawEvent retention (D34)](#rawevent-retention-d34).
2. ~~A supported tenant-deletion procedure~~ **Built 2026-10-10**
   (`delete-organization.ts`, runbook under "Deleting an organization";
   verified on disposable databases). Still open, operationally:
   - a run on a production-sized restore;
   - deploying the script to the host;
   - checking which compose file the host runs.

   Kept by design, and an open legal question (see "Audit history" above):
   whether `admin_audit_logs` rows naming a deleted organization should be
   removed or redacted (today they are kept).
3. Whether a customer deletion request carries a time promise.
4. Whether disconnect should also clear `IntegrationConfig`, and whether
   provider-side revocation should be attempted.
5. Log rotation and retention on the host.
6. Expiry cleanup for used or expired tokens and invitations.

Until these are decided, the accurate customer answer is: data, including
raw provider data, is kept for as long as your organization exists and is
not deleted by age; disconnecting a source does not delete it; deleting an
organization is an operator procedure, run on request, that removes all of
its data from the live database at once; backups age out on the schedule
above. Do not give a customer this as a commitment until Decision 3 and the
legal review allow it.

## On-call note

There is one owner and no rota. Alerting that exists in code:

- **Stalled worker cycle** (verified, `apps/worker/src/watchdog.ts`,
  `ops-alert.ts`). One elected worker checks every 2 minutes. If any
  organization's active-set poll or reconciliation is more than two intervals
  overdue (i.e. last run more than 3x its interval ago; minimum 60 s), it writes a `cycle_stalled` log line and, if configured, sends a Slack webhook
  (`OPS_ALERT_SLACK_WEBHOOK_URL`) and/or an email (`OPS_ALERT_EMAIL`, sent
  through `DEPLOYMENT_SMTP_*`). It also sends one recovery notice. If none of
  those are configured, nothing is sent.
- **A worker that has crashed** stops that watchdog too. It is only covered by
  the worker image's `HEALTHCHECK` on `/health` (`apps/worker/Dockerfile`) and
  `restart: unless-stopped` in `docker-compose.yml` (verified). The restart
  policy restarts a process that exits; it does not restart one that is only
  marked unhealthy. Nothing outside the host reports either case.
- **Errors**: structured JSON log lines only (worker: `error_reported`;
  web: Next.js's server log). Sentry was removed from the project on
  2026-10-16; there is no external error tracker.
- **Read-only checks**: the operator monitoring page (users listed in
  `PLATFORM_ADMIN_EMAILS`) and the structured JSON logs.

First checks in an incident: is the worker heartbeat recent; are any
integrations `reauth_required` or `permission_denied`; did the last backup
succeed. Recovery steps are in [deployment.md](deployment.md) (see "Common
mistakes and quick recovery").

**Documentation gap:** the restore and secret-rotation scripts refer to
`docker-compose.prod.yml`. That file is not in the repository. The scripts
fall back to `docker-compose.yml` when it is missing, so the production compose
file has not been audited. It must be checked on the host.

**Decision:** who is contacted, through which channel, and the response
target. Whether `OPS_ALERT_*` is configured in production is **not verified**.
