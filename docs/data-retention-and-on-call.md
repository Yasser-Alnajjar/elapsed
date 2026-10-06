# Data retention, deletion and on-call

Roadmap task **H-5** (was 7.11). Audit and documentation only: nothing here
was built or changed in code. Audited against the repository on 2026-09-29.

Each statement is one of:

- **Verified**: read in the code or schema, or reproduced.
- **Not verified**: true only per documentation or config in the repo; it
  cannot be confirmed without access to the production host.
- **Decision**: not built or not decided. Do not promise it to a customer.

## What is kept, and for how long

| Data | Retention today | Basis |
| --- | --- | --- |
| `RawEvent` (provider payloads, append-only, for replay) | No expiry. No prune, purge or archive job exists in `apps/` or `packages/`. | Verified |
| `NormalizedEvent` | No expiry. Rows are replaced when a case is re-normalized (the provider `normalize.ts` files call `deleteMany` on stale rows), so it is derived data, not an audit log. | Verified |
| `Evaluation`, `Commitment`, `LegSpan`, `Notification` | No expiry. | Verified |
| `Case`, `Customer`, policies, calendars | Kept until the organization is removed. | Verified |
| `PasswordResetToken`, `EmailVerificationToken` | Rows are not deleted on use or expiry. Only unused tokens for the same user are removed when a new one is issued. They go with the user. | Verified |
| `OrganizationInvitation` | No expiry cleanup found. | Verified |
| `IntegrationDataOperation` (who backed up or cleaned up which integration's data) | No expiry. Never edited or deleted after it is finished; removed with the organization. | Verified |
| Sign-in sessions | Signed JWTs, not database rows. `User.sessionVersion` revokes them. Nothing is stored server-side. | Verified |
| Container logs | No `logging:` options in any compose file in the repo, so Docker's default applies. No rotation is configured by the repo. | Verified for the repo; host `daemon.json` **not verified** |
| Database dumps | `scripts/backup.sh` deletes dumps older than `RETENTION_DAYS` (default 14) after a successful, readable dump. Off-site copies are only made if `OFFSITE_COPY_CMD` is set, and their retention is set on the bucket. | Script verified; whether cron and off-site copy are actually installed on the host **not verified** |

There is no per-plan retention window in the schema or code. The
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
- No provider-side token revocation is called; only local credentials are
  cleared. Stated in the Zendesk route, and none of the other disconnect
  routes call a revoke endpoint either. The customer should revoke the app in
  the provider if they want the grant gone.
- The organization's OAuth app config (`IntegrationConfig`) is not cleared by
  a disconnect. Verified: no disconnect route touches it.
- A disconnected integration's detail page stays reachable (it needs the
  `Integration` row, not live credentials), so its data can be seen and cleaned
  up. Verified: `getIntegrationDetailData`.

**Cleaning up one integration's data** (owner, explicit, never part of
disconnect): `POST /api/integrations/{provider}/cleanup`, implemented by
`cleanupIntegrationData` (`packages/db/src/integration-data-cleanup.ts`).
Refused with 409 unless the integration is `disconnected`; the request must name
the provider. Runs in one transaction under the organization lock.
- Deleted: the integration's `RawEvent` rows and every `NormalizedEvent` derived
  from them (on any case); the `Case` rows it created, with what the schema
  cascades from a case (links, commitments, evaluations, notifications, policy
  changes, leg spans, and events other sources attached to that case); its
  `CustomerIdentity` rows and the customers they named, but only customers with
  no remaining case, no other identity, no calendar override and no SLA policy
  referencing them; its own evidence on `CaseLink` rows of other integrations'
  cases (the link is deleted only if no other producer's evidence, `officialLink`
  or `intercomJiraKey`, remains). The integration's `cursor`, normalization
  watermark and pending renormalize request are reset, so a reconnect backfills
  from scratch.
- Kept: the `Integration` row (status stays `disconnected`, `webhookSecret`,
  `connectedAt`, `disconnectedAt` and last-sync history), `IntegrationConfig`,
  every other integration's raw and normalized events and cases, SLA policies
  (including those a Zendesk import created), calendars and `SlaImportSummary`
  (organization configuration, not imported ticket data).
- Recorded in `IntegrationDataOperation` (started, then completed or failed, with
  who ran it and the counts), shown in the Activity list on Settings → Data. Not
  in `AdminAuditLog`: that log is platform-operator only and has no tenant
  path. Other owner actions (disconnect, config delete) still have no audit trail.
- Database backups keep the deleted data until they age out.

**Exporting one integration's data** (owner, read-only): `POST
/api/integrations/{provider}/export` with a `format` form field, implemented by
`startIntegrationExport` (`packages/db/src/integration-data-export.ts`) and the
serializers in `apps/web/src/lib/data-export/`. There was no existing mechanism
to reuse: `scripts/backup.sh` is the operator's whole-database `pg_dump` and
stays the only disaster-recovery backup, and the Concierge export pulls live from
the provider with its credentials, so it neither reads stored data nor works
for a disconnected integration.
- Formats: `ndjson` (gzip JSON Lines, default), `json` (one document), `csv` (a
  zip, one CSV per record type), all complete copies; and `pdf`, a summary report
  (`startIntegrationReport`: counts, period covered, commitments by status, the 25
  most recent cases, recent activity), which is not a backup.
- The complete formats are one record stream (the same scope cleanup deletes, one
  shared definition `integrationDataWhere`) serialized as it is read, in keyset
  pages, so memory stays flat on large raw-event sets. The CSV zip is written by a
  small streaming writer without ZIP64: past 4 GiB it fails and the operation is
  recorded as failed, and JSON Lines has no such limit. CSV goes through the same
  formula-injection guard as the other CSV exports, so it is not byte-lossless.
  The PDF is built with a small dependency-free writer (standard fonts, WinAnsi
  text: characters outside it print as `?`).
- Not a point-in-time snapshot; never contains `Integration.credentials` or
  `webhookSecret`. It is a copy for the customer, not a restore tool: no restore
  procedure exists.
- Recorded in `IntegrationDataOperation` like a cleanup: kind `backup` with
  `details.format` for every format (the PDF included, shown as "Report" in
  Activity); a download the client abandons, even before its first record, is
  recorded as failed (`Download interrupted`).
- Export and cleanup are independent: cleanup never creates or requires an export.

**Removing a team member**: `removeMember` deletes the `User` row
(`packages/db/src/members.ts`); their tokens go with it (cascade). Verified.

**Deleting an organization**: no application feature, API or script does this.
Verified by search. It can be done by hand with `DELETE FROM organizations`.
The schema is set up so that deletion removes all of a tenant's data, and
this was reproduced, with a caveat:

- Reproduced on a throwaway Postgres 16 with all migrations applied and the
  5,000-case perf seed (210,237 raw events, 210,237 normalized events,
  10,000 commitments). After the delete, organizations, users, cases, raw
  events, normalized events and evaluations were all at zero.
- **It does not finish in a usable time as the schema stands.**
  `normalized_events.sourceRawEventId` is a foreign key to `raw_events` with
  `ON DELETE RESTRICT` and **no index**, so each cascaded raw-event delete
  scans `normalized_events`. Without the index, the delete was still running
  after 17 minutes and was cancelled. With an index on that column, added to
  the throwaway database only, it finished in about 2 seconds. It also held
  locks for the whole run.
- **Index added 2026-10-03** (migration
  `20261003120000_normalized_event_source_raw_event_index`, roadmap H-5).
  Re-measured on two 2,000-case perf-seed organizations: 1.4 s with the
  index, cancelled at 120 s without it. The deletion procedure itself is still
  a Decision (below).

**Backups** keep deleted data until they age out (see the table above).

## Decisions (owner) — not built

1. A retention period for `RawEvent`, and whether anything prunes or archives it.
2. A supported tenant-deletion procedure: a script (the index above is now in place),
   a rehearsed run, and a check that no tenant-owned data is left behind. (A
   self-service per-integration cleanup exists, see above; whole-organization
   deletion does not.)
3. Whether a customer deletion request carries a time promise.
4. Whether disconnect should also clear `IntegrationConfig`, and whether
   provider-side revocation should be attempted.
5. Log rotation and retention on the host.
6. Expiry cleanup for used or expired tokens and invitations.

Until these are decided, the accurate customer answer is: data is retained
until it is removed; an owner can remove one disconnected integration's imported
data themselves; removing a whole organization is a manual operator action that
has a known performance problem; backups age out on the schedule above.

## On-call note

There is one owner and no rota. Alerting that exists in code:

- **Stalled worker cycle** (verified, `apps/worker/src/watchdog.ts`,
  `ops-alert.ts`). One elected worker checks every 2 minutes. If any
  organization's active-set poll or reconciliation is more than two intervals
  overdue (i.e. last run more than 3x its interval ago; minimum 60 s), it sends a Sentry message and, if configured, a Slack webhook
  (`OPS_ALERT_SLACK_WEBHOOK_URL`) and/or an email (`OPS_ALERT_EMAIL`, sent
  through `DEPLOYMENT_SMTP_*`). It also sends one recovery notice. If none of
  those are configured, nothing is sent.
- **A worker that has crashed** stops that watchdog too. It is only covered by
  the worker image's `HEALTHCHECK` on `/health` (`apps/worker/Dockerfile`) and
  `restart: unless-stopped` in `docker-compose.yml` (verified). The restart
  policy restarts a process that exits; it does not restart one that is only
  marked unhealthy. Nothing outside the host reports either case.
- **Errors**: Sentry, only if `SENTRY_DSN` is set. Whether it is set in
  production is **not verified**.
- **Read-only checks**: the operator monitoring page (users listed in
  `PLATFORM_ADMIN_EMAILS`) and the structured JSON logs.

First checks in an incident: is the worker heartbeat recent; are any
integrations `reauth_required` or `permission_denied`; did the last backup
succeed. Recovery steps are in [deployment-runbook.md](deployment-runbook.md)
and [deployment.md](deployment.md).

**Documentation gap:** those two documents and the backup scripts refer to
`docker-compose.prod.yml`. That file is not in the repository. The scripts
fall back to `docker-compose.yml` when it is missing, so the production compose
file has not been audited. It must be checked on the host.

**Decision:** who is contacted, through which channel, and the response
target. Whether `OPS_ALERT_*` is configured in production is **not verified**.
