# Custom REST Beta: deploying the two Compose settings

Status: **EXECUTED 2026-10-10 by the owner on the production host at commit `8a4ee1e`** (see "Execution record" at the end). The steps below were corrected after that run: the host uses `.env`, not `.env.prod`, and a restrictive `umask` must never be active during the merge. Nothing here is to be re-run without a new explicit approval.

## Preconditions and what this deployment does NOT do

- **Explicit owner authorization for the production deployment is required and has NOT been given.** Do not run any command below, change `.env`, or restart services until it is.
- Deploying does not open the Beta. The Custom REST rollout block (`N9.14-F1`) stays in place: Custom REST remains allowlist-only, is never opened to all organizations and never promoted to Stable by this deployment. Open gates at the time of writing: D-07 qualified legal review, (O-2, the fixed outbound IP, is no longer a gate: owner decision 2026-10-10, Option A, deferred indefinitely) and this deployment with its verification (validation master, closure ledger). O-1 and O-3 are decided and only await the reviewer's wording.

## What changes

| Setting                             | Service | Value                     | Effect                                                                                                                                                                                           |
| ----------------------------------- | ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CUSTOM_PROVIDER_LIVE_CASE_CEILING` | worker  | default `1000`            | A Custom REST source may hold at most 1,000 live cases; a pass that would exceed it stops with nothing written. Provisional Beta safeguard (OD-08); do not raise it before a real-host benchmark |
| `GUARD_OVERRIDE_OPERATOR_EMAILS`    | web     | empty by default (nobody) | Platform operators listed here (and also in `PLATFORM_ADMIN_EMAILS`) may apply a support-assisted guard override                                                                                 |

Both are optional. With neither set in `.env`, the ceiling is 1000 (Compose and compiled default) and nobody holds the override permission. Compose file: commits `8b123a5` and `e888a54` on `main`.

## Dependency you must know about

The settings are read by code that exists only in the N2 to N10 release (C-11, owner gate OD-05). On an older build the variables are passed but ignored, so deploying only the Compose file changes nothing. The first effective deployment is therefore the release deployment: follow `docs/deployment.md` for the release (migrations, backup first) and add the steps below to it. Check what is running first:

```bash
cd <deploy-dir>
git rev-parse --short HEAD && git status --short | head
docker compose -f docker-compose.yml --env-file .env ps
```

## 0. Before

```bash
# Backup (production-backup-runbook.md), then confirm it is readable.
# Record the current commit for rollback:
git rev-parse HEAD > /tmp/custom-beta-rollback-commit.txt
```

Optional, in `.env` (check the CURRENT values first with the A5 commands in the execution record; a value already in `.env` overrides the Compose default) (leave both unset to take the safe defaults):

```text
CUSTOM_PROVIDER_LIVE_CASE_CEILING=1000
GUARD_OVERRIDE_OPERATOR_EMAILS=
```

Do not set `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS` in production.

## 1. Deploy

```bash
umask 022                      # MUST be 022: a leftover umask 077 (for example from the backup command) writes source files as 0600 and the worker image cannot read them
git fetch origin main && git merge --ff-only <approved-sha>
git ls-files -z | xargs -0 stat -c '%a %n' | awk '$1 !~ /[0-7][4-7][4-7]$/' | wc -l   # expect 0
# Pre-flight: the rendered configuration must show the two settings on the right services only.
docker compose -f docker-compose.yml --env-file .env config \
  | grep -nE "CUSTOM_PROVIDER_LIVE_CASE_CEILING|GUARD_OVERRIDE_OPERATOR_EMAILS"
# Expect: the ceiling under worker only (1000), the override list under web only.

docker compose -f docker-compose.yml --env-file .env up -d --build
docker compose -f docker-compose.yml --env-file .env ps
```

`migrate` runs first and `web`/`worker` wait for it (migrations are forward-only).

## 2. Verify

```bash
C="docker compose -f docker-compose.yml --env-file .env"
$C ps                                                    # postgres, web, worker, nginx Up/healthy
$C exec worker node -e 'console.log("ceiling", process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING)'   # 1000 (or the value you set)
$C exec web node -e 'console.log("override list entries", (process.env.GUARD_OVERRIDE_OPERATOR_EMAILS||"").split(",").filter(Boolean).length)'  # 0 unless set
$C exec web node -e 'console.log("web has ceiling:", process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING ?? "unset")'  # unset
$C logs --since 10m worker | grep -iE "error|fatal" | head      # nothing new
$C exec worker wget -qO- http://localhost:8081/health          # liveness
```

Behavior (no customer data touched): sign in as a platform operator who is NOT on the override list and call the override apply route for any id: expect 403 "needs the separate guard-override permission". Custom REST stays Beta, allowlist only: `/admin/integrations` shows Custom REST with the rollout block note.

## 3. Rollback

Settings only (keeps the release): remove the two lines from `.env.prod` or restore the defaults, then

```bash
docker compose -f docker-compose.yml --env-file .env up -d worker web
```

Whole deployment:

```bash
git checkout "$(cat /tmp/custom-beta-rollback-commit.txt)" -- docker-compose.yml   # or git checkout <that commit>
docker compose -f docker-compose.yml --env-file .env up -d --build
```

Database migrations are not reversed by this. If a migration must be undone, restore the backup taken in step 0 (data written since is lost): see `docs/production-backup-runbook.md`.

## 4. Do not do

Do not raise the ceiling, enable Custom REST for more than the allowlisted pilot organizations, or lift the rollout block (`packages/db/src/integration-catalog.ts`) as part of this deployment.

## 5. Production record and launch prerequisites (2026-10-10)

Recorded from the owner's production deployment report. **Owner-reported means the owner observed it on the production host; this repository has no access to production and none of it was independently observed here.** Details beyond what is listed (commit, timings, exact commands) were not supplied and are not recorded.

| Item                                  | State                                                                                                                                                                                               | Basis                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Worker recovery after the deployment  | Recovered                                                                                                                                                                                           | Owner-reported                                                                                                                 |
| Intercom and Jira ingestion           | Succeeding                                                                                                                                                                                          | Owner-reported                                                                                                                 |
| Database migrations                   | Applied (owner-reported status; confirm with the read-only query below if needed)                                                                                                                   | Owner-reported                                                                                                                 |
| File-permission incident              | Occurred during the deployment and was resolved by the owner                                                                                                                                        | Owner-reported; root cause and fix not recorded here                                                                           |
| Docker build context                  | `backups/` (and any nested `backups/`) is now excluded by `.dockerignore`, so dumps cannot enter image layers. Applies to the next image build only; images already built are not changed           | Independently verified: a build with the repository's `.dockerignore` and a fake `backups/` tree copied only non-ignored files |
| `GUARD_OVERRIDE_OPERATOR_EMAILS`      | Intentionally configured by the owner; left unchanged. Not a defect. Code: a session must be a platform operator **and** be on this separate list (`apps/web/src/lib/authz.ts`); empty means nobody | Independently verified: `apps/web/test/guard-override-operator.test.ts` passes. The production value was not read or recorded  |
| Intercom/Jira `status = disconnected` | **Not fixed; root cause not proven.** See below                                                                                                                                                     | Code trace only                                                                                                                |

**Intercom/Jira status.** The only code that writes `disconnected` is the owner-triggered disconnect routes (and the Slack and Custom disconnects); it also clears the credentials. The worker never writes `disconnected` and its organization query excludes rows in that status (`ORGANIZATION_TO_PROCESS_SELECT` in `apps/worker/src/cycle.ts`), and the OAuth callbacks reset a reconnected row to `connected`. A row that is genuinely `disconnected` therefore cannot be ingested by the worker, so the report's two observations cannot both hold for the same row through any code path. The likely explanations, none yet proven, are: the rows queried are not the rows ingesting (another organization or a stale/restored copy), the ingestion came from a manual out-of-band run, or the status was read from a different place. No code change was made. Do not edit the rows. Run this read-only query on production and keep its output as evidence:

```sql
SELECT o.id AS organization_id, i.provider, i.status, i."disconnectedAt", i."connectedAt",
       i."lastSyncAt", i."lastSuccessfulSyncAt", i."lastSyncError", i."failingSince",
       (i.credentials IS NOT NULL) AS has_credentials,
       (SELECT max(r."createdAt") FROM raw_events r WHERE r."integrationId" = i.id) AS last_raw_event_at
FROM integrations i JOIN organizations o ON o.id = i."organizationId"
WHERE i.provider IN ('intercom','jira')
ORDER BY i.provider, o.id;
```

Reading it: `disconnected` with `has_credentials = false` and a `last_raw_event_at` older than `disconnectedAt` is a normal customer disconnect (the ingesting integration is a different row). `disconnected` with credentials present and fresh `lastSuccessfulSyncAt` would be a real defect and the next step is then to look at who set it. If the column names differ in the deployed schema, check `\d integrations` first. Adjust nothing in the table.

### Remaining launch prerequisites for the limited Beta

Custom REST stays Beta and allowlist-only. No pilot organization is added by this document, the rollout block stays, and nothing is promoted to Stable.

1. **Owner decisions O-2 and O-3** in `implementation-plans/n9-legal-decision-sheet.md` (Part A). O-1 is already decided (D34: no age-based expiry); it needs no new decision.
2. **Qualified legal reviewer's Part B decisions**, recorded in section 6 of `implementation-plans/n9-legal-review.md` (D-07). Engineering may not decide these.
3. **Explicit approval to run section 1 of this document** on production (Compose settings), then the section 2 verification. Not executed.
4. A rebuilt image only if you want the `.dockerignore` change to take effect; this needs your approval too.

Not launch blockers, per the recorded decisions: Phase C, the Stable promotion, and the allowlist of any further organization.
