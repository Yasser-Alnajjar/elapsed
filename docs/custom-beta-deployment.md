# Custom REST Beta: deploying the two Compose settings

Status: **EXECUTED 2026-10-10 by the owner on the production host at commit `8a4ee1e`** (see "Execution record" at the end). The steps below were corrected after that run: the host uses `.env`, not `.env.prod`, and a restrictive `umask` must never be active during the merge. Nothing here is to be re-run without a new explicit approval.

## Preconditions and what this deployment does NOT do

- **The owner authorized and ran this deployment on 2026-10-10 (owner-reported; see section 5).** Any further run of the commands below, any `.env` change or any service restart needs a new explicit owner approval; the earlier one does not carry over.
- Deploying does not open the Beta. The Custom REST rollout block (`N9.14-F1`) stays in place: Custom REST remains allowlist-only, is never opened to all organizations and never promoted to Stable by this deployment. Open gates at the time of writing: D-07 qualified legal review (the only open gate on the launch path; it includes the wording items W-1 to W-3) and a separate reviewed code change lifting the rollout block. O-2 (the fixed outbound IP) is not a gate: owner decision 2026-10-10, Option A, deferred indefinitely. O-1 and O-3 are decided and only await the reviewer's wording. The deployment itself is done, but its verification is owner-reported and was not independently observed.

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
| Database migrations                   | Applied (owner-reported status; not independently confirmed)                                                                                                                   | Owner-reported                                                                                                                 |
| File-permission incident              | Occurred during the deployment and was resolved by the owner                                                                                                                                        | Owner-reported; root cause and fix not recorded here                                                                           |
| Docker build context                  | `backups/` (and any nested `backups/`) is now excluded by `.dockerignore`, so dumps cannot enter image layers. Applies to the next image build only; images already built are not changed           | Independently verified: a build with the repository's `.dockerignore` and a fake `backups/` tree copied only non-ignored files |
| `GUARD_OVERRIDE_OPERATOR_EMAILS`      | Intentionally configured by the owner; left unchanged. Not a defect. Code: a session must be a platform operator **and** be on this separate list (`apps/web/src/lib/authz.ts`); empty means nobody | Independently verified: `apps/web/test/guard-override-operator.test.ts` passes. The production value was not read or recorded  |
| Intercom/Jira `status = disconnected` | **Owner-confirmed intentional (2026-10-10). Not an incident.** No reconnect, no row edit, no follow-up query required | Owner-confirmed; not independently verified (no production access, no query run) |

**Intercom/Jira status.** The owner has confirmed that both integrations are intentionally disconnected, so this is closed as an observation and is not tracked as a defect or an open item. The earlier read-only query and its interpretation were removed from this document for that reason. Two things are kept for the record, neither reopens it: (a) code behavior, as traced earlier: the worker never writes `disconnected` and excludes rows in that status (`ORGANIZATION_TO_PROCESS_SELECT` in `apps/worker/src/cycle.ts`), so the owner-reported "Intercom and Jira ingestion succeeding" above cannot refer to the same disconnected rows; it presumably refers to other organizations' rows. That wording is left as the owner reported it and is not pursued. (b) Do not reconnect either integration or edit the rows.

### Launch readiness for the limited Beta (reconciled 2026-10-10)

Custom REST stays Beta and allowlist-only. No pilot organization is added by this document, the rollout block stays (`packages/db/src/integration-catalog.ts`), nothing is opened to all organizations and nothing is promoted to Stable. Sources: the closure ledger and sections 2.2 to 2.4 of `docs/validation/server-validation-master.md`, `implementation-plans/ROADMAP_Product.md` (N9.14-F1, D33-A1). The legal documents were not opened.

**1. Completed and verified (evidence is in the repository)**

- Phase B, B-01 to B-16 (RESULT blocks; browser-only limitation recorded for B-10, B-12, B-14).
- D-01 benchmark, as a provisional Beta safeguard only: ceiling 1,000 live cases; a real-host rerun is required before raising it.
- OD-01 / U2 for the pilot: option (b); procedure `docs/custom-provider-deletion-recovery.md`; tests `apps/web/test/custom-attention-copy.test.ts`, `packages/custom-ticket/test/ingest-runs.db.test.ts`.
- D-08 focused tests, code side (31 files, 598 tests; recorded in the ledger, not re-run). The commit `23f265b` on `origin/testing` and `b533624` on `main` exist (checked with `git merge-base`/`cat-file`).
- BL-04 / BL-10, repository side: Compose passes both settings (`8b123a5`, `e888a54`); `apps/web/test/guard-override-operator.test.ts`.
- Rollout block preserved and tested (`apps/web/test/integration-availability-admin.test.ts`, `packages/db/test/integration-availability.test.ts`, `apps/worker/test/integration-availability.test.ts`).
- `.dockerignore` excludes `backups/` (toy-build check; the already-built images are unchanged).

**2. Completed but owner-reported (not independently observed)**

- Production deployment at `8a4ee1e`, verification PASS, worker recovery, migrations applied, Intercom and Jira ingestion, the file-permission incident and its resolution.
- `GUARD_OVERRIDE_OPERATOR_EMAILS` configured by the owner on purpose (value neither read nor recorded; unchanged).
- Intercom/Jira `status = disconnected` is intentional (owner-confirmed, see above).

**3. Engineering work remaining**

Nothing on the limited-Beta path is currently actionable by engineering without a decision or the legal outcome. What is left:

- After the legal outcome (blocked by the hold, see 5): apply whatever the qualified reviewer decides to the live copy; the public docs page and marketing/`plans.ts` copy (N9.14-F1).
- Documentation closure, procedure E-03 in `docs/validation/server-validation-master.md`, including the stale status lines DC-01 to DC-20 in section 2.3.
- Not needed for the Beta: a reviewed tool to apply a legitimate mass deletion or undo a verified-404 marker (OD-01 option (a), to reconsider before GA); projector write batching; real-host benchmark rerun (only before raising the ceiling); Phase C and D-02 to D-06 (see section 6 below).

**4. Decisions or approvals required from the owner**

- **Image rebuild: approval OUTSTANDING.** Needed only for the `.dockerignore` change to apply. Not given, not done.
- **O-1 reference:** whether "D34" should exist as a roadmap decision (see "O-1 reference" below). Unresolved.
- **Timing of the first pilot allowlist entry, and which organization.** The roadmap allows individual allowlist adds under the rollout block (D33-A1, `ROADMAP_Product.md` N9.14-F1), while the ledger says "Beta is NOT open" until D-07 closes. The two are not reconciled; the owner decides whether a pilot waits for D-07. No organization added.
- Lifting the rollout block (separate reviewed change, only after N9.14-F1 closes).
- SSH exposure (TCP 22 open to the world, restriction plan written, not applied): separate from the Beta, still owner-decided.
- Non-gating owner decisions listed in section 2.4 of the validation master (OD-02 to OD-13; OD-09 N9.0-F1/F2 review and OD-10 override-confirmation expiry are the closest to Custom REST).

**5. External or legal launch gates**

- **D-07 / BL-09, qualified legal review: OPEN. The only open gate on the launch path.** It includes the wording items W-1 to W-3, and the wording of O-1 and O-3 (decided by the owner, Option A for each). Engineering may not decide these, and the legal-review hold stays: no Terms, Privacy, legal-review or decision-sheet content was opened or changed.
- Anything that depends on that content (live copy, signup acceptance behavior, public copy) is stopped at this point.

**6. Deferred, not blocking the limited Beta**

- O-2 fixed outbound IP: deferred indefinitely by owner decision (Option A); the Elastic IP 13.62.74.24 must not be released or replaced.
- Phase C (C-01 to C-18), D-02 to D-06 and other external items; the Stable promotion; opening to all organizations; allowlisting further organizations; N6.5, N7 and the N8 triggers.
- Raising the live-case ceiling above 1,000 (needs the real-host rerun).

### O-1 reference

The O-1 decision of record is in the closure ledger and `server-validation-master.md` section 2.4 (introduced in commit `abc7a33`, 2026-10-10): **Option A, align the Privacy retention/deletion wording to the implemented behavior, no purge; the wording W-1 awaits the qualified reviewer.** The label "D34: no age-based expiry" first appears in commit `9ba7866` and nowhere earlier: in this file (line removed) and in a status line of `server-validation-master.md`. It is not in `implementation-plans/ROADMAP_Product.md` (the highest decision there is D33) or in any other permitted record, so there is no original D34 reference to recover. The two statements are compatible in substance (the code has no retention expiry: `docs/data-retention-and-on-call.md` says "No expiry"), but they are different things: D34 has no decision text anywhere. The restricted decision sheet may hold the primary O-1 record; it was not opened. Alternatives, none chosen:

1. Keep the ledger/section 2.4 wording as the only O-1 record and treat "D34" as an erroneous label (current state of this file).
2. Add a roadmap decision, numbered D34, that records O-1 as decided. This creates a new decision record, so it needs the owner's explicit wording.
3. Confirm the primary record yourself against the (restricted) decision sheet and tell me what it says before anything else is edited.

Not launch blockers, per the recorded decisions: Phase C, the Stable promotion, and the allowlist of any further organization.
