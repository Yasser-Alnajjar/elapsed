# Custom REST Beta: deploying the two Compose settings

Status: **EXECUTED 2026-10-10 by the owner on the production host at commit `8a4ee1e`** (see "Execution record" at the end). The steps below were corrected after that run: the host uses `.env`, not `.env.prod`, and a restrictive `umask` must never be active during the merge. Nothing here is to be re-run without a new explicit approval.

## Preconditions and what this deployment does NOT do

- **Owner authorization:** the production deployment was authorized and run by the owner on 2026-10-10 (see "Execution record"). Any further run of the commands below, any `.env` change or any restart needs a new explicit approval.
- Deploying does not open the Beta. The Custom REST rollout block (`N9.14-F1`) stays in place: Custom REST remains Beta/allowlist-only, is never opened to all organizations and never promoted to Stable by this deployment. The block does not stop individual organizations being added to the allowlist; none has been added. Remaining launch prerequisites are listed at the end of this file. O-2 (the fixed outbound IP) is not a gate (owner decision 2026-10-10, Option A, deferred indefinitely).

## What changes

| Setting | Service | Value | Effect |
| --- | --- | --- | --- |
| `CUSTOM_PROVIDER_LIVE_CASE_CEILING` | worker | default `1000` | A Custom REST source may hold at most 1,000 live cases; a pass that would exceed it stops with nothing written. Provisional Beta safeguard (OD-08); do not raise it before a real-host benchmark |
| `GUARD_OVERRIDE_OPERATOR_EMAILS` | web | empty by default (nobody) | Platform operators listed here (and also in `PLATFORM_ADMIN_EMAILS`) may apply a support-assisted guard override |

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

Settings only (keeps the release): remove the two lines from `.env` or restore the defaults, then
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

## Execution record (2026-10-10)

Deployed by the owner on the production host to `8a4ee1e` (fast-forward from `8dc2fe8`), with `.env`, after a manual backup `backups/pre-n9-pilot-elapsed_db-20261010T143634Z.dump` (278 KB; its table-data check is not recorded in this file).

**Incident during the run (root cause confirmed, fixed by the owner):** the backup command chain ran `umask 077` in the same interactive shell, so `git merge --ff-only` wrote the updated source files as mode 0600. `COPY . .` kept those modes in the worker image, which runs the TypeScript sources as an unprivileged user, so all three workers crash-looped with `EACCES` reading `/repo/packages/db/src/integration-catalog.ts` for a short period. The owner restored read permissions on the tracked files only (not `.env`, `.git` or `backups/`) and rebuilt the workers. `docs/production-backup-runbook.md` now runs the backup umask in a subshell.

**Verification reported by the owner after the fix (not independently observed by engineering):**
- all 3 workers healthy with 0 restarts; no `EACCES` after the permission fix; database health check passed;
- Intercom and Jira ingestion succeeded, `consecutiveFailures = 0`, no `lastSyncError`;
- 68 migrations applied, none pending;
- `CUSTOM_PROVIDER_LIVE_CASE_CEILING=1000` on the worker and unset on web.

**Follow-up after the run (repository work, 2026-10-10; no production change was made by engineering):**
1. `GUARD_OVERRIDE_OPERATOR_EMAILS` has one configured entry on web. **Closed as intentionally configured** (owner decision: the entry is the owner's own and stays). The code was inspected (`apps/web/src/lib/authz.ts`, `isGuardOverrideOperator`): the list is split on commas, trimmed and lower-cased, and an address gets the override permission only if it is ALSO a platform operator (`PLATFORM_ADMIN_EMAILS`); an empty value means nobody. Tests: `apps/web/test/guard-override-operator.test.ts` (passes). The address is deliberately not recorded in this repository. The earlier wording "approved target is empty" no longer applies to this entry.
2. `status = disconnected` on Intercom and Jira: **CLOSED as owner-confirmed expected behavior (owner-reported, 2026-10-10).** The owner states they intentionally disconnected both integrations in production, so the `disconnected` values are expected and are not a defect. Not independently observed by engineering. No code change, no production action, and no reconnection was made. The earlier code trace is consistent with this: a Disconnect writes `disconnected`, the worker skips disconnected rows, and only an OAuth reconnect clears it. The Intercom/Jira ingestion success recorded above is **historical verification from before the disconnection**; ingestion does not continue while they are disconnected, and no current ingestion is claimed. Not to be reopened unless new evidence shows behavior inconsistent with the intentional disconnection (for example a `disconnected` integration that is still ingesting).
3. `backups/` is now excluded from the Docker build context (`.dockerignore`, entry `backups`). Verified by evaluating the file with the `@balena/dockerignore` matcher (`backups` and `backups/*.dump` excluded; source, `packages/db/prisma` and `scripts/` still included); no Dockerfile references `backups/`. No image was rebuilt (no Docker daemon in the engineering environment). Images already built on the host before this change may still contain the earlier dumps in their layers: that has NOT been checked, and removing them (`docker image prune` after the next approved rebuild) is an owner/host action.
4. The Custom REST allowlist is empty and no pilot organization was added; the rollout block, legal review and W-3 are unchanged. Beta is not declared ready.

## Remaining Limited Beta launch prerequisites (as of this record)

Custom REST stays Beta/allowlist. Nothing below was done by engineering and no pilot organization was added.

| # | Prerequisite | Who | State |
| --- | --- | --- | --- |
| 1 | Qualified legal reviewer records Part B decisions (and Q-1 to Q-7, including W-1 to W-3) in `implementation-plans/n9-legal-review.md` section 6 (D-07) | Qualified legal reviewer (engineering may not decide) | OPEN |
| 2 | One reviewed change to the live Terms and Privacy text, only after (1) | Engineering, after (1) | Blocked on (1) |
| 3 | Owner names the first pilot organization(s) and approves adding them to the Beta allowlist (`/admin/integrations`) | Owner | Not started; not decided |
| 4 | Owner identifies a qualified legal reviewer / engages one, if none is engaged yet | Owner | Not recorded in the repository |

Not launch prerequisites: O-2 fixed outbound IP (deferred indefinitely), lifting the rollout block (needed only to open beyond the allowlist or reach Stable, which is out of scope), O-1/O-3 owner decisions (already made; they await the reviewer's wording only). The independent re-observation of the owner-reported production verification is optional evidence, not a gate.
