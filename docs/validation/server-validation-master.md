# Server validation master checklist

**One file for every outstanding validation needed to close Elapsed's documented work: instructions, commands, pass criteria and the results you record.** Fill in the `RESULT` block under each check in place and send this file back. No other spreadsheet or report is needed.

|                    |                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepared           | 2026-10-09 (UTC), repository audit at `main` = `0e48d28` (merge of PR #49, N10)                                                                                                                   |
| Scope              | Every roadmap phase (historical 0–7, Production Hygiene H-1–H-13, N1–N10), the Launch Gate, decisions D1–D33, plans 01–10, runbooks, scripts, CI, migrations and the code paths they describe     |
| Not in scope       | Building features, writing tests, changing application behavior, approved decisions or performance limits. Where a check needs any of those first, it is marked **BLOCKED** with the prerequisite |
| Owner of execution | You. Run checks one by one, in phase order, and stop at every checkpoint that fails                                                                                                               |

---

## 0. How to use this file

### 0.1 Result recording

Every check ends with a block like this. Edit it in place.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED (reason)
Run by/date: <name>, <YYYY-MM-DD HH:MM UTC>
Where:       <machine / host>, commit <sha>, database <name>
Evidence:    <paste the requested output; counts only, no customer names, emails, ids or secrets>
Deviations:  <anything you did differently from the commands>
```

- **PASS** only when every listed pass criterion holds. A command exiting 0 is not a pass by itself.
- **FAIL**: stop, fill in the block, and follow the check's _On failure_ section. Do not continue past the next checkpoint.
- **BLOCKED**: a prerequisite is missing. Write which one.
- Paste outputs **after** removing organization names, emails, ticket subjects and tokens. Counts, timings, migration names, commit SHAs and status codes are fine.

### 0.2 Safety rules (apply to every check)

1. **Production is touched only by checks marked `PRODUCTION` in their State line.** Those are read-only unless the check says **MODIFIES PRODUCTION** and has an owner gate. No load, benchmark, seed, test suite, cleanup, restore or replay runs against the live database.
2. **Never print secrets.** No `cat .env*`, no `printenv` without `cut -d= -f1`, no `docker inspect` of environment blocks. Commands here print key **names** or `set`/`empty` only.
3. **Read-only SQL on production** goes through the `ro_sql` helper (§0.4), which forces `default_transaction_read_only=on`: any accidental write fails.
4. **Disposable databases only** for anything that writes: names containing `test` (test suites refuse other names), `sla_restore_drill` (replay tools refuse other names) or `bench`.
5. **Never `docker compose down -v`**, never `git pull` on the host between taking a backup and a migration decision (`docs/production-backup-runbook.md`, "two traps").
6. **Customer data** (dumps, replay captures, fingerprints) stays on the host or your machine, mode 700, never in git, never pasted here.
7. Existing work in your checkouts is preserved: commands use `git worktree` for other commits instead of switching branches with uncommitted changes.

### 0.3 Environment classes

| Code   | Environment                                                                                    | Used for                                           |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **E1** | Local static check (no database)                                                               | type-check, builds, `git` inspection               |
| **E2** | Isolated disposable test database (local Docker Postgres from `docker-compose.dev.yml`)        | migrations on an empty schema, focused test suites |
| **E3** | Local Docker/full stack (web + worker + mock provider + disposable DB)                         | end-to-end workflows                               |
| **E4** | Staging / production-equivalent server or a restored production backup on an isolated database | replay, drills, benchmarks                         |
| **E5** | External provider sandbox or test account                                                      | live OAuth walkthroughs, Sentry                    |
| **E6** | Production, safe operational check (read-only, or an explicitly gated owner action)            | inventory, health, backups, deployment             |
| **E7** | No new check: adequate evidence already exists                                                 | cited in §3                                        |

### 0.4 Shell helpers

**On the production host** (start of every host session; the values are from `docs/production-backup-runbook.md` "Where things are" and are confirmed by A-03 before any other host check):

```bash
ssh -i /path/to/your-key.pem ubuntu@13.62.74.24
cd ~/elapsed
export ENV_FILE=.env APP_DB=elapsed_db          # confirm both in A-03
dc() { docker compose -f docker-compose.yml --env-file "$ENV_FILE" "$@"; }
# Read-only SQL: every statement runs in a read-only transaction; writes fail.
ro_sql() { dc exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -f -' sh "$APP_DB"; }
mkdir -p ~/validation && chmod 700 ~/validation
```

**On your machine** (local disposable Postgres; the `user`/`password` credentials are the throwaway values in `docker-compose.dev.yml`):

```bash
cd /path/to/elapsed
docker compose -f docker-compose.dev.yml up -d postgres
ldc() { docker compose -f docker-compose.dev.yml "$@"; }
lsql() { ldc exec -T postgres psql -U user -d "$1" -v ON_ERROR_STOP=1 -f -; }   # usage: lsql <db> <<'SQL' ... SQL
mkdir -p ~/elapsed-validation && chmod 700 ~/elapsed-validation
```

### 0.5 Execution order and checkpoints

```text
Phase A (read-only preflight) ── CHECKPOINT A ──┐
                                                ├─> Phase B (local / disposable) ── CHECKPOINT B ──┐
                                                │                                                   │
                                                └─> Phase C1 (backup, restore, replay on copies) ───┴── CHECKPOINT C1 ──> C2 (GATED production release) ── CHECKPOINT C2 ──> C3 (post-release)
Phase D (external access / missing infrastructure): independent; each item starts when its prerequisite exists
Phase E (final acceptance and documentation closure): after every other check has a RESULT
```

| Can run in parallel                                         | Must wait                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| A-01, A-02, A-11 (local) with A-03–A-10 (host)              | Every host check after A-03 needs A-03's confirmed `ENV_FILE` and `APP_DB` |
| All of Phase B with Phase C1 (different machines/databases) | C-04 needs C-03; C-05 needs C-04; C-06/C-07 need C-05                      |
| Phase D items with everything else                          | C-11 (release) needs CHECKPOINT B **and** CHECKPOINT C1 **and** your gate  |
|                                                             | E-02 needs your explicit decision to sync `main` into `testing`            |

---

## 1. Audit scope and sources

**Documentation:** `implementation-plans/ROADMAP_Product.md` (Rev 9: Status Board, Product Decisions D1–D33, Production Hygiene H-1–H-13, N1–N10, Historical Phases 0–7, Launch Gate, Next Product Work, Validation Metrics, Review Triggers, Changelog, Appendices A–E), `roadmap-completed.md`, plans `01`–`10`, `backend_capability_summary.md`, `d29-zoho-desk-due-diligence.md`, `n9-legal-review.md`, `ignored.md`; `docs/` (`deployment.md`, `deployment-runbook.md`, `production-backup-runbook.md`, `n2-replay-runbook.md`, `h-phase-close-out.md`, `h4-sla-spot-check.md`, `capacity-limits.md`, `data-retention-and-on-call.md`, `integration-availability.md`, `customer-guide.md`); `plans/` (`07-Phase-Status.md`, `performance-plan.md`, the superseded planning files); `README.md`, `CLAUDE.md`, package READMEs, `packages/db/prisma/contract/…/README.md`.

**Code and operations:** `packages/db/prisma/schema.prisma` and all 68 migrations; the N2.10 contract directory; `docker-compose*.yml`, Dockerfiles, `apps/nginx/nginx.conf`, `.env.example` / `.env.prod.example` (key names only); `scripts/` (`backup.sh`, `restore.sh`, `restore-drill.sh`, `rotate-secrets.sh`, `prod/*.sql`, `prod/h10-verify.sh`, `h4-compare/*`); package scripts of every workspace (`replay:capture`, `replay:compare`, `replay:l2`, `backfill:breached-at`, `repair:first-response-start`, `seed:perf-baseline`, `perf:baseline`, `seed:test-customers`); `apps/worker/scripts/bench/run.ts`; `packages/custom-ticket/dev/*` (mock helpdesk, configs); `apps/web/scripts/seed-n9-test-orgs.ts`; `.github/workflows/ci.yml`; `vitest.config.ts`; the API route tree (99 `route.ts`); worker cycle, health and lock code.

**Git:** full history of `main` (unshallowed for this audit) and the remote branches `testing`, `phase/n9-custom-ticket-provider`, `phase/n10-integration-control-center`, `copy/docs-reconciliation-30min`.

**Searches:** `TODO`/`FIXME` (none in source), `not verified`, `not run`, `not deployed`, `unverified`, `pending`, `blocked`, `deferred`, `[~]`, unchecked `- [ ]` items, and "Done when"/"Phase is done when" criteria.

**Pre-run by the auditor (no database, no tests):** `pnpm --filter @sla/db generate` + `pnpm type-check` at `0e48d28` → exit 0, 0 errors (recorded in B-01); `git apply --check` of the N2.10 `schema.patch` against HEAD → applies cleanly (recorded in B-04).

---

## 2. Summary

### 2.1 Checks by phase and environment

| Phase                                 | E1  | E2  | E3  | E4  | E5 / external | E6  | Total                                     |
| ------------------------------------- | --- | --- | --- | --- | ------------- | --- | ----------------------------------------- |
| A — preflight                         | 3   | –   | –   | –   | –             | 8   | **11**                                    |
| B — isolated                          | 2   | 5   | 9   | –   | –             | –   | **16**                                    |
| C — server                            | –   | –   | –   | 9   | –             | 9   | **18**                                    |
| D — external / missing infrastructure | –   | 1   | –   | 2   | 4             | 1   | **8**                                     |
| E — final acceptance                  | 1   | 1   | –   | –   | –             | –   | **2** (+ E-03, a documentation procedure) |
| **Total**                             | 6   | 7   | 9   | 11  | 4             | 18  | **55 checks + E-03**                      |

Status at hand-over:

- **Adequate evidence, no check:** the items in §3.
- **Partly evidenced by the auditor's pre-run (no database, no tests):** B-01 (type-check PASS; `validate` still yours) and B-04 (part 1 PASS; part 2 yours).
- **Outstanding:** all 55 checks need your run or your action.
- **BLOCKED on a prerequisite (10):** B-05, B-06, D-01, D-02, D-03, D-04, D-06, D-05, D-07, D-08.
- **Owner-gated actions that modify production (5):** C-11, C-13, C-16, D-06, D-05; plus your N4.7 data entry before C-17.

**Closure ledger (current, branch tips `main` 27822e3, `claude/sharp-euler-gm4not` 27822e3, `testing` 718d742; the hand-over lines above are the original 2026-10 baseline and are kept for the record).** Closed means the evidence is in this file; nothing else is claimed.

| Item | State | Evidence |
| --- | --- | --- |
| B-01 to B-16 (Phase B) | **CLOSED** (B-10, B-12, B-14 carry the recorded browser limitation) | RESULT blocks; Checkpoint B release box ticked |
| D-01 benchmark gate | **CLOSED as a provisional Beta safeguard** (C = 1,000; real-host rerun still required before raising it) | D-01 RESULT; `docs/validation/evidence/d-01-benchmark/`; OD-08 decided |
| OD-01 / U2 | **CLOSED for the pilot** (option (b); option (a) to be reconsidered before GA) | §2.5; `docs/custom-provider-deletion-recovery.md`; `custom-attention-copy.test.ts`; `ingest-runs.db.test.ts` |
| D-08 focused tests | **CLOSED on the code/test side** (D24 replay and the real 120 s clock stay with Phase C) | D-08 Follow-ups 3 and 4: 31 files, 598 tests passed; tests on `testing` (merge 23f265b) and `main` (b533624). Not re-run in this pass, by instruction |
| BL-04 / BL-10 (repository side) | **CLOSED** | Compose passes `CUSTOM_PROVIDER_LIVE_CASE_CEILING` (worker) and `GUARD_OVERRIDE_OPERATOR_EMAILS` (web); `guard-override-operator.test.ts` |
| Production deployment of the two settings | **DEPLOYED 2026-10-10 by the owner at `8a4ee1e`; owner-reported verification PASS (not independently observed).** Two workers-down minutes from a umask/permission defect in the run, fixed by the owner. Open: `GUARD_OVERRIDE_OPERATOR_EMAILS` still has one entry (target: empty); both integrations report `status = disconnected` (UNVERIFIED, not claimed fixed); `backups/` is not in `.dockerignore` | `docs/custom-beta-deployment.md` "Execution record" |
| D-07 qualified legal review (BL-09) | **OPEN, separate required gate** | `implementation-plans/n9-legal-decision-sheet.md` Part B; live Terms/Privacy untouched; no legal approval claimed |
| O-1, O-2, O-3 (owner decisions) | **DECIDED 2026-10-10** (O-1 Option A, **O-2 Option A (changed from B later the same day)**, O-3 Option A). The decisions are closed. O-2 requires no fixed-egress-IP work for the initial launch (deferred indefinitely). O-1/O-3 wording still needs the qualified reviewer | `implementation-plans/n9-legal-decision-sheet.md` Part A (sign-off lines) and the (now historical) "O-2 implementation record"; §2.4 rows O-1 to O-3 |
| O-2 fixed outbound IP | **DEFERRED INDEFINITELY by owner decision (2026-10-10, Option A); NOT a launch gate.** Verified technical facts (kept as evidence, not a commitment): 13.62.74.24 is an Elastic IP (`eipalloc-0aca3c86efbc78f3c`) on the instance's primary interface; public subnet, internet gateway, no NAT, no IPv6; web and all 3 workers egress as 13.62.74.24; NACL allow-all; security group opens only 80, 443 and 22 to 0.0.0.0/0 with all egress allowed. Deferred, not scheduled: controlled Custom REST egress test (plan written, never run), host stop/start test, third-party allowlist follow-up (inventory written; actual registrations and customer IP restrictions unknown), further egress verification. Unchanged and separate: the Elastic IP must not be released or replaced (it also serves the app URL); the reviewer's wording W-3; the SSH exposure finding (sshd `PasswordAuthentication no`, `PubkeyAuthentication yes`, `PermitRootLogin prohibit-password`, i.e. root key login NOT disabled, with TCP 22 open to 0.0.0.0/0; restriction plan written, not applied) | decision sheet, "O-2 implementation record" (historical) |
| N9.14-F1 rollout block | **PRESERVED** | `INTEGRATION_CATALOG.custom.rolloutBlock`; tests `integration-availability.test.ts`, `integration-availability-admin.test.ts`. Allowlist management stays available; all-organizations and Stable stay refused |
| Phase C, D-02 to D-06, other external items | **NOT STARTED / BLOCKED** | unchanged |

Beta (N9.14-F1) is NOT open. It needs, additionally: D-07 qualified reviewer decisions (including the wording items W-1 to W-3, drafted in the decision sheet), the approved production deployment of the two Compose settings and its verification, and then a reviewed code change lifting the rollout block (separate decision). O-2 is no longer a launch gate (2026-10-10 owner decision: no fixed-egress-IP requirement for the initial launch).

### 2.2 Blockers that need infrastructure, provider access or an owner decision

| #             | Blocker                                                                                                                                                                                                                                 | Blocks                                                               | Kind                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| BL-01         | The plan 09 §6.10 benchmark harness does not exist. The roadmap points to `packages/custom-ticket/bench/`, which is not in the repository; `apps/worker/scripts/bench/run.ts` is the multi-worker soak harness, not the §6.10 benchmark | D-01, N9.7-F1, N9.14-F1                                              | Missing infrastructure (test tooling, `testing` branch) |
| BL-02         | No production-equivalent host specification is recorded (the EC2 size is "not recorded in the repo", `docs/capacity-limits.md`)                                                                                                         | D-01, D-02                                                           | Infrastructure (A-10 records it)                        |
| BL-03         | The N10.7 test files exist only on your local `testing-n10` branch: none of the 8 suites is on `main` or `origin/testing`, and `origin/testing-n10` does not exist                                                                      | B-06, N10.7                                                          | Branch not pushed                                       |
| BL-04         | The N9 focused tests (plan 09 §13, §8.4 items 1–7) are not written; `tenant-scope-classification` and `tenant-isolation` have no entries for the 7 N9/N10 models                                                                        | B-05, D-08, N9.5 exit, N9.14-F1 (1)                                  | Test authoring on `testing` (you must ask for it)       |
| BL-05         | No outage-injection harness for N3.6's production-scale 2-hour drill (the fake provider in `apps/worker/scripts/bench` only adds latency) and no staging host                                                                           | D-02, N3.6, N3 "Phase is done when"                                  | Missing infrastructure                                  |
| BL-06         | Zendesk sandbox login + OAuth client (required); Intercom and Linear sandbox workspaces with OAuth apps                                                                                                                                 | D-03, D-04, N5.8, H-9, 6.8, N1.13                                    | External provider accounts                              |
| BL-07         | Sentry auth token (`project:releases`, `org:read`), org and project slug; a replacement `SENTRY_DSN`                                                                                                                                    | D-06, H-6                                                            | Secret / access                                         |
| BL-08         | Replacement of the leaked `OPS_ALERT_SMTP_PASSWORD` (and the ops SMTP account decision) and `SENTRY_DSN` at their providers                                                                                                             | D-05, H-10                                                           | Third-party secrets                                     |
| BL-09         | Legal review of `implementation-plans/n9-legal-review.md`                                                                                                                                                                               | D-07, N9.14-F1 (5)                                                   | External (legal)                                        |
| BL-10         | `GUARD_OVERRIDE_OPERATOR_EMAILS` and `CUSTOM_PROVIDER_LIVE_CASE_CEILING` are read by the code but not passed to any container by `docker-compose.yml`, so neither can be set in production today                                        | The support-assisted override path; applying the benchmarked ceiling | **Ceiling half fixed in the repository 2026-10-10 (commit 8b123a5): the worker service passes `CUSTOM_PROVIDER_LIVE_CASE_CEILING` (default 1000). Not deployed. `GUARD_OVERRIDE_OPERATOR_EMAILS` is passed to the web service with an empty default (commit e888a54, tests in `apps/web/test/guard-override-operator.test.ts`). Both are in the repository and tested; neither is deployed**              |
| BL-11         | `typescript-eslint` does not support TypeScript 7 (A-11 re-checks)                                                                                                                                                                      | H-8, 7.10 lint half                                                  | Upstream                                                |
| OD-01 … OD-12 | Owner decisions, §2.4                                                                                                                                                                                                                   | various                                                              | Owner                                                   |


> **Update 2026-10-10 (Claude Code, evidence from `origin/main` at 1b1e084; the original rows above are kept as written).**
> **BL-03 is resolved:** the eight N10.7 suites are on `main` (merged by PR #50, 4316f87). B-06 was reproduced from the repository on a tree merged with `origin/main`: 8/8 files, 76 tests passed, 0 skipped (B-06 follow-up).
> **BL-04 is half stale.** Resolved: the classification entries for the 7 N9/N10 models and the tenant-isolation seeds are on `main` (0495f1f, merged by PR #51); B-05 passes on current code (2/2 files, 87 tests). Still open: the plan 09 §13 focused tests (D-08). `packages/safe-http` has no `test/` directory and `packages/custom-ticket/test` holds three files (`ingest-availability.db.test.ts`, `mapping-diagnostics.test.ts`, `supersession.test.ts`); no SSRF matrix, §6.4 guard-boundary, key-failure or Q14/R5 rollback tests were found, so D-08 stays BLOCKED until those are written on `testing` when you ask for it.
> **BL-02 is resolved:** A-10 recorded the production host (t3.medium, 2 vCPU, 3.7 GiB, three worker replicas, 2026-10-10), so D-01 and D-02 have a hardware reference. **BL-01 is resolved:** the §6.10 harness exists at `apps/worker/scripts/bench/custom-rest/` (commit dd5a2d9); D-01 results are recorded under D-01. BL-04's remaining half (the §13 tests) is partly done: see D-08's follow-up for the per-row coverage.

### 2.3 Documentation conflicts, stale claims and unsupported completion claims

Recorded, **not resolved** here. Each needs your decision or a documentation update in E-03.

| ID    | Where                                                                                                                                                                                                                                     | Claim                                                                                                                                           | What the repository shows                                                                                                                                                                                                                                                                                                    | Effect on this plan                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| DC-01 | Roadmap Status Board "Now", phase overview, N10 status line                                                                                                                                                                               | N10 "not pushed, no PR yet"; N10.1–N10.6 "committed on the phase branch, not pushed"                                                            | `main` = `0e48d28`, "Merge pull request #49 … phase/n10-integration-control-center"                                                                                                                                                                                                                                          | N10 is on `main`; status lines are stale (E-03)                                                                          |
| DC-02 | Roadmap N10.7; plan 10 §10 "As built"                                                                                                                                                                                                     | 8 suites / 72 tests passing; "the four real-database suites are listed in `vitest.config.ts`"                                                   | None of the 8 files is on `main` or `origin/testing`; `vitest.config.ts` on `main` lists none of them                                                                                                                                                                                                                        | N10.7 evidence is not in the repository (BL-03, B-06)                                                                    |
| DC-03 | Roadmap N9.7-F1                                                                                                                                                                                                                           | "Harness: `packages/custom-ticket/bench/`"                                                                                                      | Path does not exist                                                                                                                                                                                                                                                                                                          | BL-01                                                                                                                    |
| DC-04 | Roadmap N9.0-F2, Rev 8 changelog                                                                                                                                                                                                          | The copy-only change on `copy/docs-reconciliation-30min` "awaits review"                                                                        | `origin/copy/docs-reconciliation-30min` is an ancestor of `main` (merged)                                                                                                                                                                                                                                                    | N9.0-F2 needs only your confirmation (OD-09)                                                                             |
| DC-05 | `docs/h-phase-close-out.md` "Remaining owner actions", Release row                                                                                                                                                                        | 7 pending migrations (`20261001100000` … `20261004100000`) after `7cb2b9b`; safety evidence from 2026-10-05                                     | 13 migrations after `7cb2b9b` (adds 5 N9 and 1 N10). The 6 new ones were never applied to a production-backup restore                                                                                                                                                                                                        | C-05, C-07, C-08 re-establish the evidence                                                                               |
| DC-06 | `docs/deployment.md`, `deployment-runbook.md`, `h-phase-close-out.md` (H-1, H-4, H-10, N4.7 commands), `scripts/prod/h10-verify.sh`, `scripts/prod/n47-plan-records.sql` header, `scripts/restore-drill.sh`, `scripts/backup.sh` defaults | Host uses `.env.prod` and the container's `$POSTGRES_DB`                                                                                        | `docs/production-backup-runbook.md` and `n2-replay-runbook.md` ([host] notes): the host uses `.env` and the data is in `elapsed_db`; `$POSTGRES_DB` (`sla_breach_monitoring`) is empty. **`h10-verify.sh` check 3 queries `$POSTGRES_DB`, so it can PASS vacuously; `backup.sh` without `DB_NAME` dumps the empty database** | Every host command here names `$ENV_FILE` / `$APP_DB` explicitly; A-07 checks the scheduled dumps; C-15 replaces check 3 |
| DC-07 | Roadmap 7.3 (ticked)                                                                                                                                                                                                                      | "The drill timing belongs in `docs/restore-drills.log` — add the line if it isn't committed yet"                                                | `docs/restore-drills.log` has never been committed                                                                                                                                                                                                                                                                           | C-02                                                                                                                     |
| DC-08 | Roadmap Status Board "10 customers"; H-1 evidence                                                                                                                                                                                         | 10 live customers                                                                                                                               | H-1's read-only query of `elapsed_db` found 12 organizations: 11 `seed-org-*` fixtures and 1 dev sandbox. The 10 customers' data was never located                                                                                                                                                                           | OD-07; A-09 re-counts                                                                                                    |
| DC-09 | `h-phase-close-out.md` "H-10 code audit"                                                                                                                                                                                                  | "all 71 API routes re-audited"                                                                                                                  | 99 `route.ts` files now (N4–N10 added 28). N4/N10 routes have their own authz tests; the N9 custom routes have never been exercised                                                                                                                                                                                          | B-09–B-16 exercise them; H-10's "authorization audit current" needs OD-12                                                |
| DC-10 | Plan 09 §8.6, N9.5                                                                                                                                                                                                                        | New models need tenant-scope classification and isolation seeding                                                                               | 0 entries for `IntegrationSyncRun`, `CustomProviderDraft`, `CustomProviderConfigVersion`, `GuardOverride`, `CustomActivationAudit`, `IntegrationAvailability`, `IntegrationBetaAllowlist`                                                                                                                                    | BL-04, B-05                                                                                                              |
| DC-11 | Roadmap D27 + Status Board "Blocked on decisions"                                                                                                                                                                                         | D27 interpretation (2026-10-05): "new cases" = newly ingested cases; Status Board: pending confirmation whether it means manually created cases | The two statements disagree; the code blocks neither                                                                                                                                                                                                                                                                         | OD-02                                                                                                                    |
| DC-12 | Roadmap N1.18 text                                                                                                                                                                                                                        | "the production-backup replay is not done"                                                                                                      | Rev 6 reconciliation and N2.11: the host replay ran 2026-10-01 (L1 0 / 5,440, L2 0 / 7,413)                                                                                                                                                                                                                                  | Stale wording only; N1 evidence is adequate (§3)                                                                         |
| DC-13 | `h-phase-close-out.md` Release row                                                                                                                                                                                                        | "After deploying, re-run the replay on the host"                                                                                                | Not defined how, once live data has moved past the baseline                                                                                                                                                                                                                                                                  | C-14 proposes a measurable form (drift capture); OD-11                                                                   |
| DC-14 | `apps/web/test/custom-sync-state-supersession.test.ts` on `main`                                                                                                                                                                          | Sets `Organization.customProviderEnabled`                                                                                                       | That column is unread since N10 (availability comes from `integration_beta_allowlist`); the D33 update of this suite is on `testing-n10` only                                                                                                                                                                                | Expected failure recorded in B-07                                                                                        |
| DC-15 | Roadmap Status Board "Code on `main` (verified 2026-10-05, Rev 7) … 258 files / 2,766 tests"                                                                                                                                              | Current verification                                                                                                                            | N9 (PR #48) and N10 (PR #49) merged afterwards; no full-suite run on the merged HEAD is recorded                                                                                                                                                                                                                             | B-01, B-02, E-02                                                                                                         |
| DC-16 | Roadmap N9 phase line "N9.1–N9.14 implemented … unverified against a database"                                                                                                                                                            |                                                                                                                                                 | N10.1 records the N9 and N10 migrations applied to a fresh scratch database on 2026-10-09 (not a production restore; no route or flow run)                                                                                                                                                                                   | Partly stale; B-03, B-09–B-16, C-05                                                                                      |
| DC-17 | `n2-replay-runbook.md` §1, `restore-drill.sh`, `data-retention-and-on-call.md` "Documentation gap"                                                                                                                                        | `docker-compose.prod.yml`                                                                                                                       | Removed from the repository; production runs `docker-compose.yml`                                                                                                                                                                                                                                                            | Commands here use `docker-compose.yml`                                                                                   |
| DC-18 | `.github/workflows/ci.yml` comment on the `postgres` service                                                                                                                                                                              | "Only for the tenant-isolation suite … every other test uses fakes"                                                                             | `vitest.config.ts` lists 76 real-database suites                                                                                                                                                                                                                                                                             | Informational; no check                                                                                                  |
| DC-19 | `h-phase-close-out.md` Release row ("Plan the customer-facing effects first: D13 … trial lifecycle and soft limits")                                                                                                                      | Lists the customer-facing effects of the release                                                                                                | Omits N5.6: migration `20261002140000` adds `worker_settings.monthlyReportEnabled` **default `true`**, and no UI sets it, so every organization (fixtures included) gets a monthly report email and Slack message after the release                                                                                          | OD-13; C-08 records the value                                                                                            |
| DC-20 | `scripts/prod/h10-verify.sh` check 1; `h-phase-close-out.md` finding 1                                                                                                                                                                    | Compares each leaked key with the current value **of the same name**                                                                            | D8's update consolidated `OPS_ALERT_SMTP_*` into `DEPLOYMENT_SMTP_*`, so a leaked ops SMTP password reused as `DEPLOYMENT_SMTP_PASSWORD` is not detected                                                                                                                                                                     | C-15 adds a cross-name comparison                                                                                        |

### 2.4 Owner decisions needed (fill in)

| ID    | Decision                                                                                                                                                                                                                               | Needed by                             | Your decision / date |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------- |
| OD-01 | **U2** (plan 09 §15.1): cleanup after a rejected mass deletion, or written acceptance. **DECIDED 2026-10-10: option (b) for the Beta pilot only**, with the corrected distinction (a status/flag signal clears when fixed at the source; a verified-404 marker is permanent). Operator procedure: `docs/custom-provider-deletion-recovery.md`; deletion-abort message is specific (8b123a5). Option (a) must be reconsidered before GA | N9.14-F1 (Beta) | **Decided 2026-10-10.** The procedure documents a gap (no tool yet to apply a legitimate mass deletion or undo a marker); see §2.5 |
| O-1 | **Retention copy:** align the Privacy retention/deletion wording to the implemented behavior (Option A); no purge. **DECIDED 2026-10-10.** Wording W-1 awaits the qualified reviewer; live copy unchanged | D-07, L-01/L-02 | **Decided 2026-10-10; legal review PENDING** |
| O-2 | **Outbound IP:** no fixed-egress-IP requirement for the initial launch (Option A). **DECIDED 2026-10-10** (changed from Option B the same day); fixed-egress implementation and verification deferred indefinitely, not a launch gate. The existing Elastic IP 13.62.74.24 is untouched. Legal wording W-3 and the SSH-exposure decision remain separate | D-07, Q-5, F-15 | **Decided 2026-10-10; no longer blocks launch; W-3 legal review and SSH decision separate** |
| O-3 | **POST search endpoints:** retain support (Option A). **DECIDED 2026-10-10.** Wording W-2 must not imply POST is read-only; awaits the qualified reviewer | D-07, P-2, L-03 | **Decided 2026-10-10; legal review PENDING** |
| OD-02 | **D27**: which "new cases" are blocked after a trial ends (DC-11), and whether the documented gap stays                                                                                                                                | N6.4 closure, entitlement enforcement |                      |
| OD-03 | **Production billing provider** (D28 leaves it open)                                                                                                                                                                                   | N6.5, any production billing          |                      |
| OD-04 | **Pre-merge verification policy** (Q9 deferred): CI runs only for `testing`                                                                                                                                                            | Branch rules; E-02                    |                      |
| OD-06 | **H-8**: wait for upstream, or a lint-only TypeScript 6 pin                                                                                                                                                                            | H-8, 7.10                             |                      |
| OD-05 | Release go-ahead for N2–N10 (C-11), and separately for the N2.10 contract release (C-16) and the H-13 production backfill (C-13)                                                                                                       | C-11, C-13, C-16                      |                      |
| OD-07 | Where the 10 live customers' data is (DC-08), and whether the 11 `seed-org-*` fixture organizations stay in the production database (H-10 asks "no dev seed data in production")                                                       | H-1/D15 limitation, N4.7, H-10        |                      |
| OD-08 | Benchmark method of plan 09 §6.10 and the ceiling `C`. **DECIDED 2026-10-10 (provisional Beta safeguard only):** method accepted; not proof of production-host performance; `C = 1,000` live cases per integration (`L + N > C`, per normalization pass); real-host rerun required before raising it; projector write batching tracked separately with its own acceptance criteria (plan 09 §6.10 "Follow-up items") | N9.7-F1 | **Decided 2026-10-10.** Compose wiring done locally (not deployed); real-host rerun still open |
| OD-09 | **N9.0-F1** (final review of the Rev 8 Markdown diff) and **N9.0-F2** (the copy change is already merged, DC-04: confirm or revert)                                                                                                    | N9.0 follow-ups                       |                      |
| OD-10 | The proposed 24-hour expiry of override confirmations (plan 09 §15.2)                                                                                                                                                                  | N9.11 copy, D-08 tests                |                      |
| OD-11 | Accept C-14's drift-capture method as the "post-deploy replay" (DC-13)                                                                                                                                                                 | N2.11 closure wording                 |                      |
| OD-12 | Whether H-10's "authorization audit current" needs a re-audit of the 28 routes added since the 71-route audit (DC-09)                                                                                                                  | H-10                                  |                      |
| OD-13 | Monthly reports go live with the release (`worker_settings.monthlyReportEnabled` defaults to `true`, DC-19): send from the first reconciliation tick, or hold them with the kill switch (a production SQL write, C-11's optional step) | C-11                                  |                      |

### 2.5 OD-01 analysis (U2: what happens after a rejected mass deletion) — 2026-10-10

Status: **DECIDED 2026-10-10 (owner): option (b) for the Beta pilot only; option (a) to be reconsidered before GA.** The analysis below is kept as the basis. Implemented after the decision: the operator procedure (`docs/custom-provider-deletion-recovery.md`), specific customer messages for `mass_deletion`, `live_case_ceiling` and `mass_record_failure` (commit 8b123a5; tests in `apps/web/test/custom-attention-copy.test.ts`), and end-to-end tests that a deletion or ceiling abort writes nothing (`packages/custom-ticket/test/ingest-runs.db.test.ts`). The procedure states what it cannot do: it cannot apply a legitimate mass deletion and it cannot undo a verified-404 marker; both need a reviewed engineering action that does not exist. Raw events are not deleted and no guard is bypassed. Original status line: NEEDS OWNER DECISION. Plan 09 §15.1 lists U2 as the one owner decision still open and says it must be resolved, or accepted in writing, before Beta. Neither option can be chosen by engineering: (a) is a new product workflow, and (b) is a written risk acceptance. This section gives the evidence and a recommendation; nothing was implemented and no decision record was changed.

**Existing behavior (verified in code and tests).**

| Fact | Evidence |
| --- | --- |
| The deletion guard aborts when `D > max(3, 0.05 x L)`. The pass writes nothing, the watermark does not move, and the abort repeats on every pass until D falls back under the threshold. | `packages/custom-ticket/src/guards.ts`, `normalize.ts`; guard tests (D-08 row 8) |
| It cannot be overridden: the override machinery targets only the lifecycle guard (R2), and `latestLifecycleAbort` returns nothing for a deletion abort. | `overrides.ts`; `overrides.test.ts` ("a mass-deletion … abort offers nothing to override") |
| Existing data stays visible and monitored; the source goes stale. | plan 09 §6.4, §6.13 |
| A deletion has two kinds of source signal. **(i) A deletion status or flag in the ticket snapshot** is evaluated on the latest snapshot, so restoring the ticket at the source creates a newer snapshot and the signal disappears: the abort clears itself on the next pass. **(ii) A verified 404 from the ticket-detail request** writes a permanent `ticket_deleted:` raw event. Raw events are append-only and the derivation treats any marker as final, so a ticket restored at the source stays deleted and the abort does not clear. | `derive-history.test.ts` ("deletion signals are permanent in V1"); `ingest.ts` lines 474 to 498; plan 09 §6.5 |
| The customer copy for any guard abort is the same sentence: "A safety check stopped a sync before any change was applied. Review the flagged change below." Only the lifecycle guard has something to review or confirm; for a deletion abort there is no action. | `apps/web/src/lib/custom-provider/state-copy.ts` line 54; `OverridePanel.tsx` |

**Consequence for the two options.**

- **Option (b)** as worded in the plan ("a deletion abort blocks the integration until the cause is removed at the source") is accurate only for signal kind (i). For kind (ii), removing the cause at the source does **not** clear the block; with no override and no deletion of raw events permitted (plan 09 §7), only a platform-operator database action or disconnect (soft; data kept) is available. A written acceptance should therefore say so explicitly.
- **Option (a)** needs a design: who may apply a mass deletion, with what preview and confirmation, whether it is customer-owner or operator-assisted, what is audited, and how it differs from the lifecycle override that R2 deliberately kept away from deletions. It also needs a decision on whether markers from a restored ticket should be reversible (undelete is deferred in V1).

**Recommendation (for the owner to accept, change or reject; not a decision).**

1. Accept option (b) for the Beta pilot only (one or two design partners, operator-enabled per organization, plan 09 §14), **restated precisely**: a deletion abort blocks that integration's syncs; data stays visible; recovery is by restoring the deletion signal at the source if it is a status or flag signal, and by a documented operator procedure if it is a verified-404 marker.
2. During Beta, recommend that pilots use a status or flag deletion signal and not `verifyWithDetail`, because kind (i) is self-healing. Engineering can state this in the setup guidance; it changes no behavior.
3. Before the pilot starts, write the operator procedure for kind (ii) (what to check, who approves, how it is audited). It must not delete raw events; the likely shape is a new, narrowly scoped, audited operator action, which is itself small option-(a) work.
4. Make the customer copy specific: a deletion abort should say that a large number of tickets were reported deleted, that nothing was changed, and what to check, instead of "review the flagged change". This is a copy change (N9.12, verified in N9.14), not a behavior change.
5. Revisit option (a) before general availability, using what the pilot shows about how often a legitimate mass deletion happens.

**What would close OD-01:** the owner records "accept (b) for Beta as restated, with the procedure in item 3 written first" or "build (a) first", with a date. Until then N9.14-F1 and the Beta ordering rule stay open.

---

## 3. Items with adequate existing evidence (E7, no new check)

These are not re-run. Each relies on the evidence cited in its source; a later release may still need the deployment confirmation in C-12.

| Item                                              | Evidence (source)                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phases 0–5, 6.1–6.7, 7.1, 7.2, 7.4, 7.5, 7.8, 7.9 | Roadmap historical phases (ticked with dates, tests named); 7.2 verified on the EC2 host by the owner 2026-09-29                                                                                                                     |
| 7.3 backups and restore                           | Restore proven: production-backup runbook restore check (2026-10-02) and local restores of the 2026-10-02 backup (2026-10-05). **Gap:** the drill timing log was never committed → C-02 only                                         |
| 7.7 / H-7 capacity                                | `docs/capacity-limits.md` (measured on dev hardware, stated as such). The dashboard's linear growth is a recorded limit with a proposed follow-up, not a task                                                                        |
| H-1, H-4                                          | Closed 2026-09-30 by owner decision **with accepted limitations** (fixtures and one dev-sandbox tenant). Not re-run; see OD-07                                                                                                       |
| H-2, H-3, H-5, H-11, H-12                         | Roadmap Production Hygiene entries and `h-phase-close-out.md` (H-11 production repair verified by the owner)                                                                                                                         |
| N1.0–N1.12, N1.14–N1.18                           | 2026-10-01 host replay (N2.11): L1 0 differences / 5,440 records, L2 0 / 7,413; boundary allowlist empty; matrix smoke 4/4                                                                                                           |
| N2.1–N2.9                                         | Same replay; N2.6 browser comparison on fixtures (Rev 7)                                                                                                                                                                             |
| N3.1–N3.5, N3.8, N3.9                             | Restore-based backfill check and L1 replay 2026-10-05; named tests; browser checks                                                                                                                                                   |
| N4.1–N4.6, N5.1–N5.7, N6.1–N6.4, N6.6–N6.10       | Named test suites passing in the Rev 7 full run (2026-10-05). Deployment state is checked by A-04/C-12                                                                                                                               |
| N9.1                                              | Spike result recorded in plan 09 §8.2 (8/8 criteria)                                                                                                                                                                                 |
| N10.0                                             | Documentation present (D33, plan 10, runbook)                                                                                                                                                                                        |
| D1–D33                                            | Decisions recorded; D27 has the open point OD-02                                                                                                                                                                                     |
| Multi-worker leases (Appendix D invariant 11)     | Real-DB suites `work-loop.db`, `fenced-prisma.db`, `organization-work-state.db`; in production since `7cb2b9b` (contains `b354b07`). The `apps/worker/scripts/bench` soak results were never recorded, but no document requires them |

Gated or not started, so **no validation is owed now**: N6.5 (needs a go-ahead and OD-03), N7 (Zoho Desk, go-ahead), N8-S1–S8 (triggers; C-15 collects the trigger measurements), N9.12-F1 (implementation work, not validation), N10-F1 (the contract migration is not written; after N10 is deployed, OD-05), the Launch Gate (superseded, kept unticked by rule), `plans/07-Phase-Status.md` outreach metrics (historical).

---

## 4. Phase A — Safe preflight (read-only)

### A-01 — Local repository and toolchain state

|               |                                                                                      |
| ------------- | ------------------------------------------------------------------------------------ |
| Related       | All later local checks; CLAUDE.md branch rules                                       |
| Source        | `package.json` (`engines.node >=22 <23`, `packageManager pnpm@10.33.0`); `CLAUDE.md` |
| Why           | Commands below assume this commit and toolchain; uncommitted work must be preserved  |
| Environment   | E1 · your machine                                                                    |
| Prerequisites | A checkout of `Yasser-Alnajjar/elapsed`                                              |
| State         | READ-ONLY                                                                            |
| Depends on    | –                                                                                    |
| Closes        | Nothing alone; establishes the baseline commit for Phase B                           |

```bash
cd /path/to/elapsed
git fetch origin main testing
git status --short | wc -l                 # number of locally modified files (keep them)
git rev-parse --abbrev-ref HEAD; git rev-parse HEAD origin/main
node -v; pnpm -v; docker compose version --short
```

**Pass:** Node `v22.x`; pnpm `10.33.0`; Docker Compose available; you know which local changes exist. If HEAD ≠ `origin/main`, Phase B uses a worktree: `git worktree add ~/elapsed-validation/main origin/main` and run Phase B there.
**On failure:** install the stated versions; do not stash or discard local work to make the check pass.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local machine, branch main
Evidence:    origin/main sha=8dc2fe8958b15cdd87fad32ddbba5ff907d96bff (HEAD equal)   node=v22.17.0   pnpm=10.33.0   compose=5.1.3   local modified files=1 (this validation file)
Deviations:  None.
```

### A-02 — Remote and local branch inventory

|               |                                                                                 |
| ------------- | ------------------------------------------------------------------------------- |
| Related       | N10.7, N9.0-F2, E-02; DC-02, DC-04                                              |
| Source        | Roadmap N10.7 status; Branch rules "Testing branch"; `CLAUDE.md`                |
| Why           | The N10 tests and the `testing` sync state decide whether B-06 and E-02 can run |
| Environment   | E1                                                                              |
| Prerequisites | A-01                                                                            |
| State         | READ-ONLY (`git fetch` updates remote-tracking refs only)                       |
| Depends on    | A-01                                                                            |
| Closes        | Confirms or corrects DC-02 and DC-04                                            |

```bash
git ls-remote --heads origin
git branch --list 'testing*'
git log --oneline -1 testing-n10 2>/dev/null || echo "no local testing-n10"
git merge-base --is-ancestor origin/main origin/testing && echo "testing contains main" || echo "testing does NOT contain main"
git log --oneline origin/testing..origin/main | wc -l
git merge-base --is-ancestor origin/copy/docs-reconciliation-30min origin/main && echo "copy branch merged"
for f in packages/db/test/integration-availability.test.ts packages/db/test/integration-availability.db.test.ts \
         packages/custom-ticket/test/ingest-availability.db.test.ts apps/web/test/integration-availability-admin.test.ts \
         apps/web/test/integration-availability-routes.test.ts apps/web/test/integration-availability-boundary.test.ts \
         apps/web/test/admin-integrations-view.test.ts apps/worker/test/integration-availability.test.ts; do
  git cat-file -e "testing-n10:$f" 2>/dev/null && echo "testing-n10 has $f" || echo "testing-n10 LACKS $f"; done
```

**Expected (auditor's view on 2026-10-09):** remote heads `main`, `testing`, the two phase branches and `copy/docs-reconciliation-30min`; **no** `testing-n10` on the remote; `origin/testing` does not contain `main` (35 commits behind); the copy branch is merged.
**Pass:** you can record whether `testing-n10` exists locally and contains all 8 files. If it does not, B-06 is BLOCKED (BL-03).
**On failure:** none; this is inventory.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local machine
Evidence:    testing-n10 local? [x] yes (10245941, same commit as testing-n9-closure)   files present: 8/8   testing behind main by: 36 commits (origin/testing does not contain main)   copy branch merged? [x] yes
             remote heads: main, testing, phase/n9-custom-ticket-provider, phase/n10-integration-control-center, copy/docs-reconciliation-30min, claude/confident-edison-j4kvts (same commit as main); no origin/testing-n10
Deviations:  BL-03 refined: the 8 N10 suites exist locally on testing-n10 (so B-06 can run) but on no remote branch. The remote branch claude/confident-edison-j4kvts is new since the auditor's list.
```

### A-03 — Production host inventory: deployed commit, compose and env files, application database

|               |                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Related       | Status Board "What is deployed is not recorded"; DC-06, DC-17                                                               |
| Source        | Roadmap Status Board "Stage"; `docs/production-backup-runbook.md` "Where things are"; `docs/n2-replay-runbook.md` §0 [host] |
| Why           | Every host command depends on the env file name and the application database; every replay depends on the deployed commit   |
| Environment   | E6 · PRODUCTION host                                                                                                        |
| Prerequisites | SSH access                                                                                                                  |
| State         | READ-ONLY. Prints key names, the database **name**, `NEXTAUTH_URL` and `POSTGRES_DB` (not secrets); never a password        |
| Depends on    | –                                                                                                                           |
| Closes        | Records the deployed commit (`PROD_SHA`) needed by C-04 and the Status Board                                                |

```bash
cd ~/elapsed
git rev-parse HEAD; git log -1 --format='%h %ci %s'
git status --short | wc -l
ls -la .env* docker-compose*.yml 2>/dev/null | awk '{print $1, $5, $9}'
for f in .env .env.prod; do [ -f "$f" ] && printf '%s: DATABASE_URL db name = ' "$f" && sed -n 's#^DATABASE_URL=.*/\([^/?"]*\).*#\1#p' "$f"; done
grep -E '^(NEXTAUTH_URL|POSTGRES_DB)=' "${ENV_FILE:-.env}"
dc ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' | head -10
```

**Pass:** exactly one env file is in use and its `DATABASE_URL` names `elapsed_db` (or you record the real name and change `APP_DB`); the running services are `postgres`, `web`, `worker`, `nginx` (and the exited `migrate`); `PROD_SHA` is known. If `git status` shows modified files on the host, record them: the deployed code may not equal `PROD_SHA`.
**On failure (unknown deployed code, unexpected services, two candidate env files):** stop at CHECKPOINT A and report; do not guess.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       production host (t3.medium), ~/elapsed
Evidence:    PROD_SHA=8dc2fe8 (docs-only commit on top of 0e48d28, so the code is the N10 merge)   host modified files=0
             ENV_FILE=.env (only env file; .env.prod absent)   APP_DB=elapsed_db   NEXTAUTH_URL="https://13.62.74.24"
             services: postgres (healthy), web (healthy), worker x3 (healthy), nginx; images built 2026-10-09 23:49-23:56 UTC
Deviations:  `migrate` is not listed as an exited service in `dc ps` (one-shot container output not shown).
```

### A-04 — Production migration state

|               |                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Related       | Release of N2–N10; DC-05                                                                                    |
| Source        | `docs/h-phase-close-out.md` "Remaining owner actions" (Release row); `docs/production-backup-runbook.md` §1 |
| Why           | Fixes the exact pending migration set that C-05 must reproduce on a restore                                 |
| Environment   | E6 · PRODUCTION (read-only SQL)                                                                             |
| Prerequisites | A-03                                                                                                        |
| State         | READ-ONLY (`ro_sql`)                                                                                        |
| Depends on    | A-03                                                                                                        |
| Closes        | Records the production schema state (Status Board)                                                          |

```bash
ro_sql <<'SQL'
select count(*) as applied from _prisma_migrations where finished_at is not null and rolled_back_at is null;
select count(*) as failed_or_rolled_back from _prisma_migrations where finished_at is null or rolled_back_at is not null;
select migration_name, finished_at from _prisma_migrations order by started_at desc limit 5;
SQL
```

On your machine, list what is pending (replace `<LAST>` with the newest applied name):

```bash
ls packages/db/prisma/migrations | grep -v toml | awk -v last="<LAST>" '$0 > last'
```

**Expected if production is still at `7cb2b9b`:** 55 applied, 0 failed, newest `20260930170000_organization_work_state`, and 13 pending: `20261001100000` … `20261004100000` (7) plus `20261009100000`, `20261009100100`, `20261009100200`, `20261009100300`, `20261009110000`, `20261009120000`.
**Pass:** 0 failed/rolled-back rows and a pending list consisting only of repository migrations, in order.
**On failure (a failed migration row, an applied name not in the repository):** stop; report the names. Do not run `migrate`.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host, APP_DB=elapsed_db
Evidence:    applied=68   failed=0   newest=20261009120000_n10_integration_availability (finished 2026-10-09 23:56:49 UTC)
             pending (names): none. The release premise of this check (55 applied, 13 pending) is stale: N2-N10 migrations are already applied in production
Deviations:  Pending-list step on the local machine not needed (nothing pending). See "Phase A findings" below: DC-05, C-05, C-07, C-08, C-11 need rework.
```

### A-05 — Production health endpoints

|               |                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Related       | Launch Gate "health-gated startup"; 7.1; `docs/deployment.md` "Health checks and observability"      |
| Source        | `apps/web/src/app/api/health/route.ts`; `apps/worker/Dockerfile` `HEALTHCHECK`; `docs/deployment.md` |
| Why           | Baseline before any release; detects a stalled or degraded worker                                    |
| Environment   | E6 · PRODUCTION                                                                                      |
| Prerequisites | A-03 (`NEXTAUTH_URL`)                                                                                |
| State         | READ-ONLY                                                                                            |
| Depends on    | A-03                                                                                                 |
| Closes        | Baseline for C-12                                                                                    |

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "<NEXTAUTH_URL>/api/health"
curl -sS "<NEXTAUTH_URL>/api/health"; echo
for c in $(dc ps -q worker); do docker exec "$c" wget -qO- "http://localhost:8081/health" | head -c 2000; echo; done
docker ps --format '{{.Names}} {{.Status}}'
```

**Pass:** web `200 {"status":"ok","checks":{"database":"ok"}}`; every worker returns `"status":"running"` (record `degraded` with its reason); containers `healthy`.
**On failure:** a `stopped`/`stalled` worker or a 503 web is an incident: follow `docs/integration-availability.md` / `deployment-runbook.md` §12; stop this plan until healthy.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    web=200 {"status":"ok","checks":{"database":"ok"}} (https://13.62.74.24/api/health, curl -k)
             worker(s) status=running x3 (1 watchdog leader)   workState.leased=1   expiredLeases=0   overdueActive=1 (maxActiveLagMs about 1.4 s)   overdueReconciliation=0   integrations.withErrors=0
             containers: web, postgres, worker 1-3 healthy; nginx up (no healthcheck)
Deviations:  First web attempt used a literal <NEXTAUTH_URL> placeholder (my error); re-run with the real URL. -k needed (IP address, certificate presumably self-signed).
```

### A-06 — Production runtime configuration (names and set/empty only)

|               |                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | H-10 ("no development services/settings in production"), H-6, `data-retention-and-on-call.md` (`SENTRY_DSN`, `OPS_ALERT_*` "not verified"), BL-10, N9 Beta flag safety |
| Source        | `docs/data-retention-and-on-call.md` "On-call note"; `docker-compose.yml`; `.env.example`                                                                              |
| Why           | Closes four "not verified" statements and confirms no private-host override reaches production                                                                         |
| Environment   | E6 · PRODUCTION                                                                                                                                                        |
| Prerequisites | A-03                                                                                                                                                                   |
| State         | READ-ONLY. Prints `NAME=set` / `NAME=empty` only                                                                                                                       |
| Depends on    | A-03                                                                                                                                                                   |
| Closes        | `data-retention-and-on-call.md` "not verified" lines for Sentry and ops alerts                                                                                         |

```bash
for svc in web worker; do echo "== $svc"; dc exec -T "$svc" sh -c '
  for k in SENTRY_DSN OPS_ALERT_SLACK_WEBHOOK_URL OPS_ALERT_EMAIL DEPLOYMENT_SMTP_HOST PLATFORM_ADMIN_EMAILS \
           GUARD_OVERRIDE_OPERATOR_EMAILS CUSTOM_PROVIDER_LIVE_CASE_CEILING CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS \
           SMTP_ALLOW_PRIVATE_HOSTS ORGANIZATION_CONCURRENCY WORKER_LEASE_TTL_MS NODE_ENV; do
    eval v=\${$k-__unset__}; if [ "$v" = "__unset__" ]; then echo "$k=unset"; elif [ -z "$v" ]; then echo "$k=empty"; else echo "$k=set"; fi
  done'; done
dc ps worker --format '{{.Name}}' | wc -l      # number of worker replicas
```

**Pass:** `NODE_ENV=set` (value checked by C-15); `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS` and `SMTP_ALLOW_PRIVATE_HOSTS` **unset** in both; `PLATFORM_ADMIN_EMAILS=set` on web. Record the rest as facts (they are not pass/fail, except as noted in E-03).
**On failure:** a private-host override set in production is a security finding: report it before any other check.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: 2026-10-10 (partial review; not a final result)
Where:       production host, ~/elapsed; running Compose containers
Evidence:    web: SENTRY_DSN=set; DEPLOYMENT_SMTP_HOST=set; PLATFORM_ADMIN_EMAILS=set;
             GUARD_OVERRIDE_OPERATOR_EMAILS=unset; CUSTOM_PROVIDER_LIVE_CASE_CEILING=unset;
             CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=unset; SMTP_ALLOW_PRIVATE_HOSTS=unset;
             NODE_ENV=set; ORGANIZATION_CONCURRENCY=unset; WORKER_LEASE_TTL_MS=unset
             worker: SENTRY_DSN=set; OPS_ALERT_SLACK_WEBHOOK_URL=empty;
             OPS_ALERT_EMAIL=set; DEPLOYMENT_SMTP_HOST=set; PLATFORM_ADMIN_EMAILS=unset;
             GUARD_OVERRIDE_OPERATOR_EMAILS=unset; CUSTOM_PROVIDER_LIVE_CASE_CEILING=unset;
             CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=unset; SMTP_ALLOW_PRIVATE_HOSTS=unset;
             ORGANIZATION_CONCURRENCY=set; WORKER_LEASE_TTL_MS=set; NODE_ENV=unset
             worker runtime log: organizationConcurrency=3; leaseTtlMs=60000;
             claimPollMs=1000; databasePoolMax=10; opsAlertConfigured=true
             worker replicas=3; reviewed containers were healthy
Deviations:  Partial evidence only. Full A-06 pass criteria are not yet met/verified;
             investigate worker NODE_ENV and complete the remaining checks before marking PASS.
```

**Progress update — 2026-10-10 (partial; this does not mark A-06 PASS)**

Completed sub-checks:

- [x] Located the code and Compose references for the environment variables listed above.
- [x] Confirmed `PLATFORM_ADMIN_EMAILS` is passed to the `web` service in Compose and is set at runtime.
- [x] Confirmed `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS` and `SMTP_ALLOW_PRIVATE_HOSTS` are unset/empty in the inspected `web` and `worker` containers. Keep both disabled unless a documented need is reviewed.
- [x] Confirmed three worker replicas were running and healthy in the reviewed container output.
- [x] Reviewed logs showing PostgreSQL became ready after its restart and workers subsequently processed Intercom/Jira work successfully.
- [x] Confirmed `.dockerignore` excludes `.env` from the Docker build context; this is appropriate for secret hygiene.

Still open:

- [ ] Verify the complete A-06 command output and satisfy its explicit pass criteria.
- [ ] Investigate why `NODE_ENV` is unset in the worker runtime before changing configuration.
- [ ] Inspect the default/intent for `GUARD_OVERRIDE_OPERATOR_EMAILS` and `CUSTOM_PROVIDER_LIVE_CASE_CEILING`.
- [ ] Verify the worker's `dotenv -e ../../.env` target (`/repo/.env`) exists at runtime and understand mounts/startup behavior.
- [ ] Finish the other A checks; no A-03/A-04/A-05/A-07/A-08/A-09/A-10 item is marked complete by this partial review alone. (Superseded: those checks were run 2026-10-10, see their RESULT blocks.)

**Follow-up — 2026-10-10 (host run; A-06 still not marked PASS)**

- Worker `NODE_ENV`: set only in `apps/web/Dockerfile` (`ENV NODE_ENV=production`); not in `docker-compose.yml` or `apps/worker/Dockerfile`; absent from the worker's PID 1 environment. The worker starts with `node /usr/local/bin/pnpm start`. The A-06 pass criterion `NODE_ENV=set` is therefore not met for the worker. Still to check: which worker/package code branches on `NODE_ENV`.
- `/repo/.env` does not exist in the worker container and the worker has no bind mounts, so the worker's configuration comes only from Compose. The `dotenv -e ../../.env` target is absent (harmless only if the dotenv tool tolerates a missing file; the worker is running healthy).
- `GUARD_OVERRIDE_OPERATOR_EMAILS` appears in `.env.example` and `apps/web/src/lib/authz.ts` only; `CUSTOM_PROVIDER_LIVE_CASE_CEILING` in `.env.example` (commented) and `packages/custom-ticket/src/guards.ts` only. Neither is in `docker-compose.yml`: BL-10 is confirmed.

### A-07 — Scheduled backups: cron, retention, off-site copy, latest dump is the application database

|               |                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related       | 7.3, Launch Gate "Backups tested by a real restore", H-5 ("cron and off-site copy … not verified"), DC-06                                        |
| Source        | `docs/deployment.md` "Scheduled backups"; `scripts/backup.sh` (`DB_NAME` defaults to `$POSTGRES_DB`); `docs/production-backup-runbook.md` trap 1 |
| Why           | If cron runs `backup.sh` without `DB_NAME=elapsed_db`, every scheduled dump is the empty database and "succeeds"                                 |
| Environment   | E6 · PRODUCTION                                                                                                                                  |
| Prerequisites | A-03                                                                                                                                             |
| State         | READ-ONLY (`pg_restore --list` only reads the file). The cron line may contain a bucket name: redact it in the evidence                          |
| Depends on    | A-03                                                                                                                                             |
| Closes        | H-5 "not verified" backup line; part of 7.3                                                                                                      |

```bash
crontab -l 2>/dev/null | grep -n 'backup' || echo "no backup line in this user's crontab"
sudo crontab -l 2>/dev/null | grep -n 'backup' || true
ls -lht backups/ | head -8
latest=$(ls -t backups/sla-*.dump 2>/dev/null | head -1); echo "latest scheduled dump: $latest"
[ -n "$latest" ] && dc exec -T postgres pg_restore --list < "$latest" | grep -c "TABLE DATA"
tail -5 /var/log/sla-backup.log 2>/dev/null || echo "no /var/log/sla-backup.log"
```

**Pass:** a daily cron line exists and sets `DB_NAME=elapsed_db` (or an equivalent), the latest `sla-*.dump` is under 26 h old, its size is in megabytes, and its `TABLE DATA` count equals the number of application tables (≥ 29 as of N3; 40+ after N9/N10 is deployed); `OFFSITE_COPY_CMD` is set in the cron line and the log shows "copied … off-site".
**On failure:** a kilobyte-sized dump or a low table count means the scheduled backups hold the empty database. **Stop** (CHECKPOINT A) and take a manual backup with C-01 before anything else; fixing the cron line is your action.

```text
RESULT
Status:      [ ] PASS   [x] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    cron has DB_NAME? [ ] no (no backup line in user crontab or sudo crontab; /etc/cron.d has only certbot and e2scrub; only OS dpkg-db-backup timer)
             off-site? [ ] no   /var/log/sla-backup.log: absent
             latest scheduled dump: sla-20261001T104033Z.dump, about 9 days old, 4.5 MB, TABLE DATA=29 (application database, but stale)
             other dumps: sla-20260929T213644Z.dump (3.4 MB), pre-n3-elapsed_db-20261002T033846Z.dump (4.9 MB); no dump between 10-02 and C-01 on 10-10
Deviations:  FAIL per the check's own criteria: no scheduled backup exists at all. N4-N10 migrations were applied with no backup after 10-02. Mitigated by C-01 (2026-10-10). Fixing the cron line is an owner action (open).
```

### A-08 — Host log rotation and container log configuration

|               |                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Related       | H-5 Decision 5; `data-retention-and-on-call.md` "Container logs … host `daemon.json` not verified" |
| Source        | `docs/data-retention-and-on-call.md` "What is kept"                                                |
| Why           | Unbounded container logs can fill the disk; the document marks it unverified                       |
| Environment   | E6 · PRODUCTION                                                                                    |
| Prerequisites | A-03                                                                                               |
| State         | READ-ONLY                                                                                          |
| Depends on    | A-03                                                                                               |
| Closes        | The "not verified" container-log line                                                              |

```bash
cat /etc/docker/daemon.json 2>/dev/null || echo "no /etc/docker/daemon.json"
for n in web postgres nginx $(dc ps -q worker); do docker inspect --format '{{.Name}} {{json .HostConfig.LogConfig}}' "$n"; done
df -h / /var/lib/docker 2>/dev/null
```

**Pass:** you can record the driver and any `max-size`/`max-file`. Rotation absent is a **finding** for OD-style decision H-5/5, not a failure of this check; disk use above 80 % is a failure (stop and free space before C-01).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    log driver/options=json-file with no max-size / max-file on web, postgres, nginx, worker 1-3; no /etc/docker/daemon.json
             disk use=77% of 48 GB (36 GB used, 12 GB free)
Deviations:  Finding for H-5/5: container logs are unbounded and disk is close to the 80% stop line. Passes this check (below 80%).
```

### A-09 — Tenant and provider inventory (counts only)

|               |                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Related       | H-1 limitation, D15, N4.7, H-10 manual line "no dev seed data", DC-08, N9/N10 deployment impact |
| Source        | `scripts/prod/h1-provider-pairs.sql`; `scripts/prod/n47-plan-records.sql`; roadmap H-1          |
| Why           | Establishes whether production holds the 10 customers, the fixtures, any Custom REST flags      |
| Environment   | E6 · PRODUCTION (read-only SQL)                                                                 |
| Prerequisites | A-03                                                                                            |
| State         | READ-ONLY; prints counts only                                                                   |
| Depends on    | A-03                                                                                            |
| Closes        | Input to OD-07 and N4.7                                                                         |

```bash
ro_sql < scripts/prod/h1-provider-pairs.sql
ro_sql <<'SQL'
select (id like 'seed-org-%') as fixture, count(*) as organizations from organizations group by 1 order by 1;
select provider, status, count(*) from integrations group by 1, 2 order by 1, 2;
select count(*) as cases_total, count(*) filter (where "deletedAt" is null) as cases_live from cases;
SQL
```

If the second block errors on `"deletedAt"`, run it without that `filter` and note it (column names are from the current schema; production may predate them).
**Pass:** counts recorded; the number of non-fixture organizations is known.
**On failure / surprise:** if non-fixture organizations ≠ 10 or 1, stop and resolve OD-07 before N4.7 (C-17).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    fixture orgs=0   non-fixture orgs=1
             integrations by provider/status= intercom connected 1, jira connected 1 (the single organization pairs intercom with jira, 0 unhealthy)
             cases total/live=24/24
Deviations:  Production now holds 1 organization, not the 10 customers of DC-08 and not the 12 organizations of the H-1 query: the 11 seed-org-* fixtures are gone. OD-07 still open (where the 10 customers' data is). Count of 1 is within the check's accepted range.
```

### A-10 — Production host hardware profile

|               |                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Related       | N9.7-F1 ("production-equivalent host"), N3.6, `capacity-limits.md` ("EC2 instance size is not recorded") |
| Source        | Plan 09 §6.10 "Environment"; `docs/capacity-limits.md` "Where"                                           |
| Why           | D-01 and D-02 must run on hardware equal to or recorded against production                               |
| Environment   | E6 · PRODUCTION                                                                                          |
| Prerequisites | –                                                                                                        |
| State         | READ-ONLY                                                                                                |
| Depends on    | –                                                                                                        |
| Closes        | BL-02                                                                                                    |

```bash
nproc; lscpu | grep -E 'Model name|^CPU\(s\)'; free -h; df -h /
TOKEN=$(curl -sS -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') && \
  curl -sS -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type; echo
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'
```

**Pass:** instance type (or vCPU/RAM), disk and current container memory recorded.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    instance type=t3.medium   vCPU=2 (Xeon Platinum 8259CL 2.5 GHz)   RAM=3.7 GiB (2 GiB swap, 161 MiB used)   disk=48 GB (12 GB free)
             container mem (web/worker/postgres)= 156 MiB / about 195-220 MiB each (x3) / 49 MiB
Deviations:  Closes BL-02 (host spec recorded). A 2 vCPU / 3.7 GiB host is small for D-01/D-02 benchmarks.
```

### A-11 — Upstream lint blocker re-check (H-8)

|               |                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- |
| Related       | H-8, 7.10 (lint half)                                                                       |
| Source        | Roadmap H-8 ("typescript-eslint 8.71.0 still declares typescript <6.1.0")                   |
| Why           | Decides whether H-8 is still blocked                                                        |
| Environment   | E1 (npm registry read)                                                                      |
| Prerequisites | –                                                                                           |
| State         | READ-ONLY                                                                                   |
| Depends on    | –                                                                                           |
| Closes        | H-8 only if support exists **and** a lint step is then added (implementation, out of scope) |

```bash
pnpm view typescript-eslint@latest version peerDependencies
grep -m1 '"typescript"' package.json
```

**Pass:** the result is recorded. If `peerDependencies.typescript` admits `7.x`, H-8 becomes implementable (tell me); otherwise it stays blocked (OD-06).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local machine
Evidence:    typescript-eslint version=8.71.1   peer typescript=>=4.8.4 <6.1.0 (repo uses ^7.0.2)
Deviations:  H-8 is still blocked upstream (BL-11, OD-06).
```

### Phase A findings — 2026-10-10 (host run)

1. **The N2-N10 release is already applied in production.** 68 migrations applied, newest `20261009120000_n10_integration_availability` (2026-10-09 23:56 UTC), deployed at `8dc2fe8`. DC-05 is stale, and C-04/C-05/C-07/C-08/C-11 assume a pre-release database; they need rework as "verify the deployed release" checks (decision pending).
2. **No scheduled backups exist** (A-07 FAIL). The last scheduled dump is 2026-10-01. Owner action: add a cron line with `DB_NAME=elapsed_db` and an off-site copy.
3. **Production holds 1 organization** (Intercom + Jira, 24 cases), no `seed-org-*` fixtures (A-09; DC-08, OD-07).
4. **Container logs are unbounded and the disk is at 77%** (A-08).
5. **Worker has no `NODE_ENV`; `GUARD_OVERRIDE_OPERATOR_EMAILS` and `CUSTOM_PROVIDER_LIVE_CASE_CEILING` are not passed to any container** (A-06, BL-10).
6. **Host spec recorded: t3.medium, 2 vCPU, 3.7 GiB** (A-10, BL-02).

### CHECKPOINT A

Continue only if **all** hold: A-03 identified one env file, the application database and `PROD_SHA`; A-04 shows no failed migration; A-05 healthy; A-06 shows no private-host override in production; A-07 shows that a valid backup of the application database exists (or you have just taken one with C-01). Otherwise stop and send this file back.

```text
CHECKPOINT A:  [x] passed — continue   [ ] stopped — reason:
               Passed on 2026-10-10 on these conditions: A-07 FAILED (no scheduled backup) and was covered by the manual backup C-01, whose
               live-table-count check (44 expected) and off-host copy are still open. A-01, A-02, A-06 (complete) and A-11 have not been run.
```

---

## 5. Phase B — Isolated validation (your machine, disposable resources)

> **Branch policy (CLAUDE.md).** B-01–B-04 are static or migration checks allowed on `main`. **B-05–B-07 run test suites**: running them is a testing request, which `CLAUDE.md` places on the `testing` branch. Run them in a worktree of `testing-n10` (B-06) or of `testing` once you have decided to sync it with `main`; on a plain `main` worktree only if you explicitly authorize testing on `main`. **B-08–B-16 run the application locally against a disposable database and a local mock provider**; they write nothing outside your machine.

### B-01 — Prisma client generation and workspace type-check

|               |                                                                                     |
| ------------- | ----------------------------------------------------------------------------------- |
| Related       | DC-15; N9/N10 merge; roadmap "Task completion verification"                         |
| Source        | `package.json` `type-check`; `.github/workflows/ci.yml` (generate, then type-check) |
| Why           | No type-check of the merged HEAD (`0e48d28`) is recorded                            |
| Environment   | E1                                                                                  |
| Prerequisites | A-01; `pnpm install --frozen-lockfile`                                              |
| State         | Writes only `packages/db/generated/` (git-ignored)                                  |
| Depends on    | A-01                                                                                |
| Closes        | Part of DC-15; prerequisite for every other B check                                 |

```bash
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @sla/db generate
pnpm --filter @sla/db validate
pnpm type-check; echo "exit=$?"
```

**Pass:** generate succeeds; `validate` succeeds; `type-check` exit 0 with no `error TS` lines.
**On failure:** paste the first 20 error lines; stop Phase B (a release cannot proceed).

```text
RESULT
Status:      [x] PASS (auditor pre-run, type-check part)   [x] PASS (your run)   [ ] FAIL
Run by/date: auditor, 2026-10-09 UTC — commit 0e48d28 — `pnpm --filter @sla/db generate` OK, `pnpm type-check` exit 0, 0 "error TS" lines
             (without the generate step every package importing @sla/db fails: CI's order matters)
Your run:    2026-10-10, commit 292cb26 (branch claude/sharp-euler-gm4not), executed by Claude Code from the cloud session: `pnpm --filter @sla/db generate` exit=0 (Prisma Client 7.10.0)  validate=exit 0 ("The schema at prisma/schema.prisma is valid")  type-check exit=0, 0 "error TS" lines (log ~/elapsed-validation/b01-typecheck.log)
Deviations:  `pnpm install --frozen-lockfile` was not re-run for this step (dependencies were already installed; the B-04 worktree install succeeded with the frozen lockfile). A first `validate` without DATABASE_URL exited 1 because prisma.config needs the variable; with the documented placeholder it passes.
```

### B-02 — Package, web and worker builds

|               |                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- |
| Related       | DC-15; N10 verification policy ("web build on the phase branch"); release readiness         |
| Source        | `package.json` (`build`, `web:build`, `worker:build`); `.github/workflows/ci.yml` env block |
| Why           | The merged HEAD has no recorded build                                                       |
| Environment   | E1                                                                                          |
| Prerequisites | B-01                                                                                        |
| State         | Writes build output only (`dist/`, `.next/`, git-ignored)                                   |
| Depends on    | B-01                                                                                        |
| Closes        | DC-15 (with B-01)                                                                           |

The placeholder values are CI's (`.github/workflows/ci.yml`); nothing connects to them. `web:build` loads `../../.env` without overriding exported variables.

```bash
export DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" NEXTAUTH_SECRET="ci-nextauth-secret" NEXTAUTH_URL="http://localhost:3000" \
       INTEGRATION_CONFIG_ENCRYPTION_KEY="ci-integration-config-encryption-key" SMTP_ENCRYPTION_KEY="ci-smtp-encryption-key" \
       SENTRY_AUTH_TOKEN= SENTRY_ORG= SENTRY_PROJECT=
pnpm build; echo "packages exit=$?"
pnpm web:build; echo "web exit=$?"
pnpm worker:build; echo "worker exit=$?"
```

**Pass:** all three exit 0. **On failure:** paste the error; stop Phase B.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar (executed by Claude Code from the cloud session), 2026-10-10
Where:       commit 308a8db (branch claude/sharp-euler-gm4not), cloud container, Node 22, pnpm 10.33.0; CI placeholder env exactly as the command block, DATABASE_URL pointing at a non-existent `ci` database (nothing connects)
Evidence:    packages exit=0   web exit=0   worker exit=0 (`pnpm build`, `pnpm web:build`, `pnpm worker:build`; logs in ~/elapsed-validation/b02-*.log)
Deviations:  The local e2e web and worker dev processes were stopped before the build so `.next` was not shared. No build output was inspected beyond exit codes and the Next.js route summary.
```

### B-03 — All 68 migrations on an empty disposable database; no schema drift

|               |                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.5 ("not applied to a database"), N10.1, DC-16; release migration safety                                                                                  |
| Source        | Roadmap N9.5, N10.1; `package.json` `test:db:prepare`                                                                                                       |
| Why           | Proves the migration chain, including the `ALTER TYPE … ADD VALUE 'custom'` and the N10 seed, applies in order on PostgreSQL 16 and matches `schema.prisma` |
| Environment   | E2                                                                                                                                                          |
| Prerequisites | B-01; local Docker Postgres (§0.4)                                                                                                                          |
| State         | Creates and later drops the disposable database `sla_validation_test`                                                                                       |
| Depends on    | B-01                                                                                                                                                        |
| Closes        | N9.5 "not applied to a database" (empty-schema half)                                                                                                        |

```bash
ldc exec -T postgres dropdb -U user --if-exists sla_validation_test
ldc exec -T postgres createdb -U user sla_validation_test
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
pnpm test:db:prepare
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @sla/db exec prisma migrate status
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "diff exit=$?"
lsql sla_validation_test <<'SQL'
select count(*) as migrations from _prisma_migrations where finished_at is not null;
select provider, enabled, "releaseStage", "betaAccess" from integration_availability order by provider;
select count(*) as allowlist_rows from integration_beta_allowlist;
SQL
```

**Pass:** `migrate status` says the schema is up to date; `migrate diff` exit **0** (empty diff); 68 migrations; 6 availability rows: zendesk/jira/linear `stable`, intercom/github `beta`+`all_organizations`, custom `beta`+`allowlist`, all `enabled=t`; 0 allowlist rows (no organizations).
**On failure:** exit 2 from `migrate diff` means drift: paste the summary and stop. Keep the database for B-04/B-05.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar (executed by Claude Code from the cloud session), 2026-10-10
Where:       commit 308a8db   db=sla_validation_test (freshly created, empty) on a local PostgreSQL 16 in the cloud container (no Docker: psql replaced ldc/lsql); not production, not a shared database
Evidence:    `pnpm test:db:prepare` applied all migrations ("All migrations have been successfully applied")   migrate status="68 migrations found ... Database schema is up to date!"   diff exit=0 ("No difference detected")   migrations=68
             availability rows=6: zendesk/jira/linear stable+allowlist; intercom/github beta+all_organizations; custom beta+allowlist; all enabled=t   allowlist=0
Deviations:  PostgreSQL 16 from the OS package, not the postgres:16-alpine image. A pre-check query meant to print the target database errored on a typo in the query (no effect); the target was fixed by the database name in TEST_DATABASE_URL, which `test:db:prepare` uses exclusively. The database is kept for B-04/B-05.
```

### B-04 — N2.10 contract artefacts still apply to the current schema

|               |                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N2.10, N2.11                                                                                                                      |
| Source        | Roadmap N2.10 ("Re-verified 2026-10-05 … `schema.patch` still applies"); `packages/db/prisma/contract/20261001110000_…/README.md` |
| Why           | Six migrations have landed since the 2026-10-05 re-verification                                                                   |
| Environment   | E1 + E2                                                                                                                           |
| Prerequisites | B-03                                                                                                                              |
| State         | Part 1 read-only; part 2 writes `sla_validation_test` and a temporary worktree                                                    |
| Depends on    | B-03                                                                                                                              |
| Closes        | Schema-level half of the N2.10 re-verification (the data half is C-09)                                                            |

```bash
# Part 1 (static)
git apply --check packages/db/prisma/contract/20261001110000_contract_customer_identity_and_case_source/schema.patch && echo "schema.patch applies"
# Part 2 (disposable DB): apply the contract, validate the patched schema against it, roll back
C=packages/db/prisma/contract/20261001110000_contract_customer_identity_and_case_source
lsql sla_validation_test < $C/migration.sql
git worktree add ~/elapsed-validation/n210 HEAD && (cd ~/elapsed-validation/n210 && git apply $C/schema.patch && pnpm install --frozen-lockfile >/dev/null && \
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "contracted diff exit=$?")
lsql sla_validation_test < $C/rollback.sql
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "after rollback diff exit=$?"
git worktree remove --force ~/elapsed-validation/n210
```

**Pass:** part 1 applies; the contract migration runs without error; the patched schema matches the contracted database (exit 0); after `rollback.sql` the original schema matches again (exit 0).
**On failure:** N2.10 needs rework before C-09/C-16; record and continue Phase B.

```text
RESULT
Status:      [x] PASS (part 1, auditor pre-run 2026-10-09 at 0e48d28: `git apply --check` succeeded)   [x] PASS (part 2)   [ ] FAIL
Run by/date: Yasser Alnajjar (executed by Claude Code from the cloud session), 2026-10-10
Where:       commit 292cb26; db=sla_validation_test (verified with `select current_database()`; local PostgreSQL 16 in the cloud container, not production); temporary worktree of HEAD, removed afterwards
Evidence:    part 1 re-run: `git apply --check` => "schema.patch applies"   migration.sql ran without error (exit 0)   contracted diff exit=0 ("No difference detected", schema.patch applied in the worktree, frozen-lockfile install exit 0)   rollback.sql exit 0   after rollback diff exit=0 ("No difference detected")
Deviations:  psql replaced lsql (no Docker). The database was empty (no data), so this is the schema-level half only; the data half stays with C-09. sla_validation_test is back at the original schema for B-05.
```

### B-05 — Tenant-scope classification and isolation for the N9/N10 models

|               |                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.5 exit, plan 09 §8.6, H-10 "tenant isolation covers every model", DC-10                                                                                                |
| Source        | Plan 09 §8.6 ("the first test fails for any model without a classification"); roadmap N9.5 ("to be added on `testing`")                                                   |
| Why           | Seven new models have no classification or isolation seeding                                                                                                              |
| Environment   | E2                                                                                                                                                                        |
| Prerequisites | **BLOCKED (BL-04)** until classification entries and isolation seeds for the 7 models are written on `testing` (ask for it). Running it before that only confirms the gap |
| State         | Truncates every table of `sla_validation_test` (the suite refuses databases without `test` in the name)                                                                   |
| Depends on    | B-03                                                                                                                                                                      |
| Closes        | N9.5 tenant-scope exit; H-10 "tenant isolation covers every model" (code half)                                                                                            |

```bash
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
npx vitest run apps/web/test/tenant-scope-classification.test.ts apps/web/test/tenant-isolation.test.ts
```

**Pass (after the prerequisite):** both files pass and the classification lists `IntegrationSyncRun`, `CustomProviderDraft`, `CustomProviderConfigVersion`, `GuardOverride`, `CustomActivationAudit`, `IntegrationAvailability` (platform-level, not tenant-scoped, must be declared as such) and `IntegrationBetaAllowlist`.
**Expected before the prerequisite:** a classification failure naming those models. Record it; it is the evidence for DC-10.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED (BL-04)   [ ] SKIPPED
Run by/date: Yasser Alnajjar (executed by Claude Code from the cloud session), 2026-10-10
Where:       branch/worktree=claude/sharp-euler-gm4not at 292cb26 (no `testing` worktree used)   db=sla_validation_test (local PostgreSQL 16, name contains "test", 68 migrations, schema restored after B-04)
Evidence:    `npx vitest run apps/web/test/tenant-scope-classification.test.ts apps/web/test/tenant-isolation.test.ts`: files passed 2/2, 87 tests passed (vitest v5.0.0)   unclassified models listed=none
             classification in tenant-scope-classification.test.ts (lines 67-74): CustomActivationAudit, CustomProviderConfigVersion, CustomProviderDraft, GuardOverride, IntegrationBetaAllowlist, IntegrationSyncRun = direct; IntegrationAvailability = global (platform-level)
             tenant-isolation.test.ts seeds customActivationAudit, customProviderConfigVersion, customProviderDraft, guardOverride, integrationBetaAllowlist and integrationSyncRun for both organizations (lines 410-435)
Deviations:  CONFLICT, reported and not resolved here: BL-04 (§2.2) and this check's Prerequisites say the 7 models have no classification or isolation seeds and the work must be written on `testing`, but this branch already contains both (last change to the classification test: 0495f1f). The pass criteria are met on current code, so the check is recorded PASS; BL-04's text and D-08's BLOCKED (BL-04) row were not changed. Follow-up 2026-10-10 (after `git fetch`): 0495f1f (2026-10-10 11:25 +03:00) IS on origin/main (merged by PR #51, 1b1e084) and the same seven classification entries and isolation seeds are in main's two test files; it is NOT on origin/testing or origin/testing-n10. An earlier note here suggested the entries might exist only on this branch; that was wrong (the local main was stale). BL-04 and D-08 are stale relative to main; an owner decision is needed before they are edited.
             Follow-up (same day): re-run on commit bb85aef (this branch merged with origin/main 1b1e084): 2/2 files, 87 tests passed. Decision applied in the §2.2 update note: BL-04's classification/isolation half is resolved by 0495f1f; D-08 (the §13 tests) is NOT resolved and stays BLOCKED. Only these two test files were run, per instruction (no B-07, no full suite).
```

### B-06 — N10 focused suites (plan 10 §10)

|               |                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Related       | N10.7, N10 "Phase is done when" bullets 1–3, DC-02                                                            |
| Source        | Plan 10 §10 "As built"; roadmap N10.7                                                                         |
| Why           | The recorded pass (8 suites / 72 tests) is not reproducible from the repository                               |
| Environment   | E2                                                                                                            |
| Prerequisites | **BLOCKED (BL-03)** unless A-02 found all 8 files on your local `testing-n10`. Push it or tell me where it is |
| State         | Truncates `sla_validation_test`                                                                               |
| Depends on    | B-03, A-02                                                                                                    |
| Closes        | N10.7 (and with it N10's phase status, together with B-13–B-15)                                               |

```bash
git worktree add ~/elapsed-validation/testing-n10 testing-n10 && cd ~/elapsed-validation/testing-n10
pnpm install --frozen-lockfile && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @sla/db generate
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
pnpm test:db:prepare
npx vitest run packages/db/test/integration-availability.test.ts packages/db/test/integration-availability.db.test.ts \
  packages/custom-ticket/test/ingest-availability.db.test.ts apps/web/test/integration-availability-admin.test.ts \
  apps/web/test/integration-availability-routes.test.ts apps/web/test/integration-availability-boundary.test.ts \
  apps/web/test/admin-integrations-view.test.ts apps/worker/test/integration-availability.test.ts
```

**Pass:** 8 files, 0 failures, 0 skipped (a skipped DB suite means `TEST_DATABASE_URL` was not seen: that is a FAIL). Record the test count (documented: 72).
**On failure:** paste failing test names; N10.7 stays open.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED (BL-03)   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 08:14 UTC
Where:       testing-n10 sha=10245941, db=sla_validation_test (68 migrations, no pending)
Evidence:    files 8/8   tests passed=72   failed=0   skipped=0 (4 real-database suites ran against Postgres: admin 23, routes 10, db 3, custom ingest 3)
Deviations:  None. Closes the reproducibility half of DC-02 for the local branch; the suites are still not on any remote branch (BL-03), so they are not yet on `main` or `origin/testing`.
Follow-up 2026-10-10 (Claude Code, cloud session): why PASS and BLOCKED both appeared: the PASS is the run on the local `testing-n10` branch; BLOCKED (BL-03) described that the files were not on any remote branch. Since then PR #50 (4316f87) merged `testing-n10` into `main`, so the files are in the repository and BL-03 is resolved.
             Reproduced from the repository: branch claude/sharp-euler-gm4not merged with origin/main (bb85aef); db=sla_validation_test (68 migrations, `test:db:prepare`: no pending); `npx vitest run` of the 8 files listed above: Test Files 8 passed (8), Tests 76 passed (76), 0 failed, 0 skipped (72 documented + D33-A1 additions from 0edad35/5d06593).
```

### B-07 — Regression suites for the shared N9/N10 changes that already exist

|               |                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Related       | N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15 (D32), N10.3; D13(b); plan 09 §10 "focused regression coverage" |
| Source        | Roadmap N9.3/N9.8a/N9.9/N9.10/N9.13 ("Not run: … regression"); plan 09 §10, §13 "Regression" row       |
| Why           | Every shared-code task records its regression run as "for `testing`"; none is recorded                 |
| Environment   | E2                                                                                                     |
| Prerequisites | B-03; a testing authorization (see the branch policy above)                                            |
| State         | Truncates `sla_validation_test`                                                                        |
| Depends on    | B-03                                                                                                   |
| Closes        | The "regression" half of N9.14-F1 (1) for the existing suites; the D24 replay half is C-07             |

```bash
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
pnpm test:db:prepare
npx vitest run \
  apps/web/test/stale-source-notifications.test.ts apps/worker/test/integration-sync-health.db.test.ts \
  apps/worker/test/sync-history-no-change.db.test.ts apps/worker/test/not-configured.db.test.ts \
  apps/web/test/custom-sync-state-supersession.test.ts apps/web/test/custom-sync-history-view.test.ts \
  apps/web/test/custom-provider-failure-details.test.ts apps/web/test/provider-matrix-smoke.test.ts \
  apps/web/test/projector.test.ts apps/web/test/case-detail-conversation.test.ts apps/web/test/sla-golden-scenarios.test.ts \
  apps/web/test/sla-e2e-matrix.test.ts apps/web/test/tenant-isolation.test.ts apps/web/test/admin-authz.test.ts \
  apps/web/test/admin-boundary.test.ts apps/web/test/providers.test.ts \
  packages/notifications/test packages/logger/test packages/ingestion packages/core/test/provider-boundary.test.ts
```

**Pass:** every file passes, **except** these three, which are known before you start and must fail only for the stated reason: `apps/web/test/providers.test.ts` (predates the `custom` provider) and `apps/web/test/admin-boundary.test.ts` "thin wrapper" (predates the SEO metadata import), both recorded in roadmap N10.7; `apps/web/test/custom-sync-state-supersession.test.ts` may fail because it still sets `customProviderEnabled` (DC-14). Any other failure is a FAIL.
**On failure:** paste test names and the first assertion; the release (C-11) waits.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar (authorized the run); executed by Claude Code from the cloud session, 2026-10-10
Where:       branch claude/sharp-euler-gm4not, sha=73f7e4a (contains origin/main 1b1e084); db=sla_validation_test (verified: `select current_database()` = sla_validation_test, port 5432 of the container's local PostgreSQL 16, 68 migrations; the suites refuse a database name without "test"); `DATABASE_URL` unset for the run so only TEST_DATABASE_URL was used
Evidence:    command= `pnpm test:db:prepare` (no pending migrations), then the exact `npx vitest run ...` file list of this check, run as `env -u DATABASE_URL npx vitest run <files>`; exit 0
             files passed 26/26   tests passed 293/293   failed 0   skipped 0 (log ~/elapsed-validation/b07.log)
             known failures observed: providers [ ] no   admin-boundary [ ] no   supersession [ ] no   other failures= none
             the three candidates re-run on their own: providers.test.ts 13 passed, admin-boundary.test.ts 12 passed, custom-sync-state-supersession.test.ts 8 passed (33/33, 0 failed, 0 skipped)
Deviations:  The three documented known failures did NOT occur. Commit 0495f1f (merged by PR #51) updated exactly these three files (providers.test.ts, admin-boundary.test.ts, custom-sync-state-supersession.test.ts) for the custom provider, the SEO metadata import and D33, so the baseline in the Pass paragraph above is stale for the current code. No new, changed or unexpected failures. The original Pass paragraph is kept as written. Only the prescribed scope ran; no application code, migration or configuration changed; a vitest JSON report file created by the verbose re-run was removed (one file, in the git-ignored .vitest folder).
```

### B-08 — Local end-to-end stack (disposable database, web, worker, mock helpdesk)

|               |                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.14-F1 (2) "an end-to-end run against a real or fixture API"; N9.11/N9.12 "not exercised"; N10 browser checks                                                                 |
| Source        | `packages/custom-ticket/dev/mock-helpdesk.mjs` and `mock-helpdesk-config.json`; `apps/web/scripts/seed-n9-test-orgs.ts`; `.env.example` (`CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS`) |
| Why           | Shared setup for B-09–B-16                                                                                                                                                      |
| Environment   | E3                                                                                                                                                                              |
| Prerequisites | B-01; local Docker Postgres; `openssl`                                                                                                                                          |
| State         | Creates `sla_e2e_test`; writes `~/elapsed-validation/e2e.env` (throwaway secrets, mode 600, outside the repo) and `.local/n9-test-credentials.txt` (git-ignored)       |
| Depends on    | B-01                                                                                                                                                                            |
| Closes        | Setup only                                                                                                                                                                      |

```bash
ldc exec -T postgres dropdb -U user --if-exists sla_e2e_test && ldc exec -T postgres createdb -U user sla_e2e_test
umask 077; cat > ~/elapsed-validation/e2e.env <<EOF
export DATABASE_URL="postgresql://user:password@localhost:5432/sla_e2e_test?schema=public"
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"
export INTEGRATION_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export SMTP_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export INTEGRATION_TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export PLATFORM_ADMIN_EMAILS="n9-owner-b@example.test"
export CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1
export WORKER_ACTIVE_POLL_MS=30000
# Neutralize anything in ../../.env that could reach a real service (exported empty values are not overridden):
export SENTRY_DSN= OPS_ALERT_SLACK_WEBHOOK_URL= OPS_ALERT_EMAIL= DEPLOYMENT_SMTP_HOST= GUARD_OVERRIDE_OPERATOR_EMAILS=
EOF
source ~/elapsed-validation/e2e.env
pnpm --filter @sla/db exec prisma migrate deploy
pnpm --filter @sla/web exec tsx scripts/seed-n9-test-orgs.ts
```

Then three terminals, each starting with `source ~/elapsed-validation/e2e.env`:

```bash
node packages/custom-ticket/dev/mock-helpdesk.mjs 2>&1 | tee ~/elapsed-validation/mock.log        # terminal 1
pnpm web:dev 2>&1 | tee ~/elapsed-validation/web.log                                              # terminal 2
pnpm worker:dev 2>&1 | tee ~/elapsed-validation/worker.log                                        # terminal 3
```

> **Worker check (2026-10-10 run).** The sign-in test only proves the **web** uses `sla_e2e_test`. A worker started from another directory or without `source ~/elapsed-validation/e2e.env` silently uses the repository's `.env` database instead, polls that database's own Custom REST integrations (against the mock) and never touches `sla_e2e_test`: no sync-run rows and 0 cases appear. Start the worker from the same worktree as web and confirm it with `grep -m1 -o '"organizationId":"[a-z0-9]*"' ~/elapsed-validation/worker.log` against `select id from organizations` in `sla_e2e_test`.

**Pass:** `curl -s localhost:3000/api/health` returns `{"status":"ok",...}`; `curl -s localhost:4010/__state | head -c 200` returns JSON; the three accounts are in `.local/n9-test-credentials.txt`; you can sign in as `n9-owner-a@example.test` and see your organization (this proves web uses `sla_e2e_test`).
**On failure:** if sign-in fails with the seeded account, web is not using `sla_e2e_test` (check that `DATABASE_URL` was exported in that terminal); stop B-09+.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar (first part); closed by Claude Code from the cloud session, 2026-10-10
Where:       commit 292cb26, branch claude/sharp-euler-gm4not; local PostgreSQL 16 in the cloud container, db=sla_e2e_test, throwaway secrets in ~/elapsed-validation/e2e.env (mode 600), web `pnpm web:dev`, worker `pnpm worker:dev`, mock helpdesk
Evidence:    health={"status":"ok","checks":{"database":"ok"}}   mock state ok? [x] ({"mode":"normal","delayMs":0,"tickets":40,"open":27})   sign-in as owner A ok? [x] (credentials sign-in returned 200; the session shows n9-owner-a@example.test, role owner, organization cmv2a3jc4...)
             three accounts in .local/n9-test-credentials.txt (git-ignored): owner A, member A, owner B   worker check: the two organizationId values in worker.log equal the two ids in `select id from organizations` of sla_e2e_test, and worker.log shows integrations=1 for organization A after activation, so the worker uses sla_e2e_test
Deviations:  No Docker: local PostgreSQL 16 and psql instead of ldc/lsql. Owner A signed in through the NextAuth credentials endpoint (curl), not the browser form. The web dev server first returned 404 for /api/health because a stale .next from `pnpm web:build` (B-02) was present; removing the git-ignored apps/web/.next and restarting web fixed it. The mock keeps its state in memory, so a restart resets it to 40 tickets (reset to 140 for B-12).
```

### B-09 — Custom REST end-to-end: draft, test, sample, preview, validate, activate, history import with partial runs

|               |                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.11, N9.12, N9.6, N9.7, N9.8, N9.9, N9.14-F1 (2); plan 09 §4, §6.1, §6.12, §6.13; Q12, R3, R6                                                            |
| Source        | Roadmap N9.11 ("Not run: any route against a database or a real API"), N9.12 ("not exercised in a browser"), N9.6 ("`runCustomIngest` … has not been run") |
| Why           | No custom route, activation, worker ingest or partial run has ever run                                                                                     |
| Environment   | E3                                                                                                                                                         |
| Prerequisites | B-08 running                                                                                                                                               |
| State         | Writes `sla_e2e_test` only                                                                                                                                 |
| Depends on    | B-08                                                                                                                                                       |
| Closes        | N9.14-F1 item (2) "end-to-end run against a fixture API" (together with B-10–B-16)                                                                         |

The mock is slowed so that the first import cannot finish inside one 120 s run (140 tickets, 14 listing pages and 280 child requests at 1.5 s each). All 140 tickets fall inside the configuration's 90-day import window (the mock spaces tickets 0.6 days apart).

```bash
source ~/elapsed-validation/e2e.env
mock() { curl -sS -X POST localhost:4010/__control -H 'content-type: application/json' -d "$1"; echo; }
st() { lsql sla_e2e_test <<'SQL'
select outcome, "reasonCode", "recordsFetched", "failureCount", "finishedAt" - "startedAt" as took from integration_sync_runs order by "startedAt" desc limit 3;
select status, "activeConfigVersion", "lastSuccessfulSyncAt" is not null as synced, "consecutiveFailures", "failingSince" is not null as failing,
       left(coalesce("lastSyncError", ''), 80) as err, "lastDataChangedAt" is not null as data_changed from integrations where provider = 'custom';
select count(*) as cases, count(*) filter (where "closedAt" is not null) as closed from cases where system = 'custom' and "deletedAt" is null;
SQL
}
mock '{"mode":"normal","delayMs":0,"ticketCount":140}'   # normal for steps 1-3; switch to slow only right before Activate (see the note below)
```

> **Correction (2026-10-10 run).** Test connection, Sample, Preview and Validate must run with the mock in `normal` mode. Preview has a 60 s total budget (`openOutboundSession`, `totalMs` 60,000) and reads up to 2 pages of tickets with 2 child requests each; at 1.5 s per request it times out (`custom_outbound_check_failed ... code: timeout`) and the wizard reports "Preview: 0 tickets read, 0 would be created, 0 would fail", which looks like an empty source rather than a timeout. Run `mock '{"mode":"slow","delayMs":1500,"ticketCount":140}'` after Validate and before **Activate**. Preview is also rate limited (a second attempt within about a minute returns 429).

1. Signed in as **owner A**, create a native SLA policy in **Settings → SLA → Configuration** with First Response, Next Reply and Resolution targets (custom sources use native policies, D31). Record the targets.
2. Open `http://localhost:3000/settings/integrations/custom`. In the **Advanced JSON** tab paste `packages/custom-ticket/dev/mock-helpdesk-config.json`; enter the API key `mock-key-123` in the credential field.
3. Run **Test connection**, **Sample**, **Preview**, **Validate**, then **Activate** (read the commitment impact panel, confirm).
4. After the first worker run finishes (about 2.5 minutes), run `st` and look at the integration page. Repeat `st` every 2–3 minutes until `cases = 140`, then `mock '{"mode":"normal"}'`, wait one minute and run `st` once more, plus:

```bash
lsql sla_e2e_test <<'SQL'
select count(*) as dup_cases from (select "externalId" from cases where system = 'custom' group by 1 having count(*) > 1) d;
select count(*) as dup_raw from (select "integrationId", "providerEventId", "sourceHash" from raw_events group by 1, 2, 3 having count(*) > 1) d;
select count(*) as events from normalized_events where system = 'custom';
select m.kind, m.status, count(*) from commitments m join cases c on c.id = m."caseId" where c.system = 'custom' group by 1, 2 order by 1, 2;
SQL
```

**Pass:**

- Step 3: test connection `ok`, no validation error, activation succeeds.
- While importing: every stored run is `partial` with reason `budget_exhausted` (or `run_cap_reached`) and `took` ≤ about 125 s; `synced = f` (a partial run never advances `lastSuccessfulSyncAt`), `consecutiveFailures = 0`, `failing = f`, `err` empty; the integration page shows **"Importing history"** (or "Catching up"), never "Needs attention" or a failure; `cases` grows between runs.
- After the import: `cases = 140`, `closed = 46` (every third mock ticket is solved), a run `ok` (or no new row once D32 skips a no-change run), `synced = t`, page **"Up to date"**; `dup_cases = 0`, `dup_raw = 0`; events > 0; commitments exist for `first_response`, `next_reply` and `resolution`.
  **On failure:** record the step, the run rows and the UI state; stop B-10–B-16 if activation failed.

```text
RESULT
Status:      [x] PASS (after the fix below; the first run of the unpatched code FAILED)   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local e2e stack (sla_e2e_test, worktree of 8dc2fe8 + uncommitted patch to packages/safe-http/src/client.ts), mock helpdesk with 140 tickets
Evidence:    test connection=ok   Sample ok   Preview (normal mode)= 20 tickets read, 20 would be created, 0 would fail   Validate ok   activate ok? [x]
             partial runs (count, reason, max took)= unpatched code: run 1 = failed/timeout, 2:00.57, 0 tickets read, but 90 cases committed, consecutiveFailures=1, failing=t, page "Needs attention"; patched code: run 2 = partial/budget_exhausted, 2:00.03, 30 tickets, failureCount 0; run 3 = ok, 1:03.96, 20 tickets
             counters during import= unpatched: failing=t, err "Custom source request failed (timeout)"; patched: consecutiveFailures=0, failing=f, err empty
             UI during import= unpatched: "Needs attention" (not "Importing history"); patched run: UI not recorded
             final cases/closed=140/46   dup_cases=0   dup_raw=0   events=650   commitments by kind/status= first_response met 62, breached 78; resolution at_risk 9, breached 131; next_reply breached 19   UI after= not recorded
Deviations:  FINDING (fixed in the working tree, uncommitted): a request still in flight when the 120 s run budget ended was recorded as `timeout`, so a run that was making progress was `failed` (consecutiveFailures 1, failing, "Needs attention", 0 tickets read although 90 cases were committed). Plan 09 Q12 requires `partial`/`budget_exhausted`. Fix: packages/safe-http/src/client.ts, an attempt whose timeout was clipped by the remaining budget now throws `budget_exhausted` (an unclipped 30 s timeout stays `timeout`). No regression test added (branch policy); the page copy still shows "Needs attention" only for the pre-fix run.
             Also: Preview reports "0 tickets read" when it times out (mock in slow mode), indistinguishable from an empty source. Preview, Validate and the other checks must run with the mock in `normal` mode; B-09 instructions corrected. The worker must run from the same worktree and database as web (B-08 note).
             The unsynced-state UI strings ("Importing history", "Up to date") were not captured.
```

### B-10 — Secret sentinel and redaction scan (plan 09 §8.4 items 1–2, 6)

|               |                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.5 exit (§8.4), N9.3, Q16                                                                                                      |
| Source        | Plan 09 §8.4 "Verification required before Beta"                                                                                 |
| Why           | §8.4 verification has not been run                                                                                               |
| Environment   | E3                                                                                                                               |
| Prerequisites | B-09 PASS. The sentinel is the mock's key `mock-key-123`                                                                         |
| State         | READ-ONLY                                                                                                                        |
| Depends on    | B-09 (the scan is repeated once more at the end of the next check, after its error paths write `lastSyncError` and sync history) |
| Closes        | §8.4 items (1) and (2) for database, logs, sync history and API responses; items (3)–(7) stay with D-08                          |

```bash
source ~/elapsed-validation/e2e.env
lsql sla_e2e_test <<'SQL'
select 'integrations' as t, count(*) from integrations i where i.credentials::text like '%mock-key-123%' or coalesce(i."lastSyncError", '') like '%mock-key-123%'
union all select 'drafts', count(*) from custom_provider_drafts d where d::text like '%mock-key-123%'
union all select 'config_versions', count(*) from custom_provider_config_versions v where v::text like '%mock-key-123%'
union all select 'sync_runs', count(*) from integration_sync_runs r where r::text like '%mock-key-123%'
union all select 'raw_events', count(*) from raw_events e where e.payload::text like '%mock-key-123%'
union all select 'admin_audit', count(*) from admin_audit_logs a where a::text like '%mock-key-123%'
union all select 'activation_audit', count(*) from custom_activation_audits a where a::text like '%mock-key-123%';
select key, left(value #>> '{}', 7) as prefix from integrations, jsonb_each(credentials -> 'secrets') where provider = 'custom';
SQL
grep -c 'mock-key-123' ~/elapsed-validation/web.log ~/elapsed-validation/worker.log
```

In the browser's developer tools (Network), reload the custom integration page and the draft editor and search the responses for `mock-key-123`. If `credentials -> 'secrets'` is not an object in your data, record the actual shape instead of the prefix list.
**Pass:** every count is **0**; every secret's prefix is `enc:v1:`; both log greps print `0`; no API response contains the sentinel (the UI shows "set / not set").
**On failure:** a security finding that blocks Beta: record where the sentinel appeared (table, log or response), not the surrounding content.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED   (database and log scan pass; browser response check closed 2026-10-10 by Claude Code)
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local e2e stack, sla_e2e_test
Evidence:    counts (7 rows)= integrations 0, drafts 0, config_versions 0, sync_runs 0, raw_events 0, admin_audit 0, activation_audit 0   secret prefixes= apiKey enc:v1:   web.log=0   worker.log=0   API responses clean? [x] yes   repeated after B-11? [x] yes, all 7 counts 0, web.log 0, worker.log 0
             response check (local e2e stack, owner A, 2026-10-10): sentinel hits=0 in the HTML and RSC responses of /settings/integrations/custom (300,244 bytes) and /settings/integrations (328,724 bytes), and in the JSON of GET /api/integrations/custom/status, GET .../draft, GET .../overrides and POST .../draft/from-active; the editor draft response lists `"secretsSet":["apiKey"]` (names only). Repeat on the final stack: DB tables 0, web.log 0, worker.log 0.
Deviations:  The response check used curl as the signed-in owner (page HTML, RSC payload and the API GET/POST routes the editor calls), not the browser Network panel; client-side requests that only the browser issues were not observed. GET .../draft returned an empty draft after activation, so the draft payload was checked through from-active. mock.log contains the key twice, which is expected: the mock server receives it as its API key and B-10 scans the web and worker logs only.
```

### B-11 — Failure classes, recovery and freshness (plan 09 §6.12, §8.3, §8.5; R3)

|               |                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.6, N9.9, N9.15; D13(b); N3.1 health columns                                                                                                                                                                                          |
| Source        | Plan 09 §6.12 rule ("a real provider, authentication, transport or processing failure keeps the applicable failure policy"); §13 "Partial runs and failures" and "SSRF and the client" (redirects); `SyncRunOutcome` in `schema.prisma` |
| Why           | The failure policy of the custom source has never run end to end                                                                                                                                                                        |
| Environment   | E3                                                                                                                                                                                                                                      |
| Prerequisites | B-09 PASS (import complete, mock `normal`)                                                                                                                                                                                              |
| State         | Writes `sla_e2e_test`; changes the mock's mode                                                                                                                                                                                          |
| Depends on    | B-09                                                                                                                                                                                                                                    |
| Closes        | End-to-end evidence for N9.6/N9.9 failure handling (unit coverage stays with D-08)                                                                                                                                                      |

For each mode, wait for the next worker run to finish (watch `worker.log`), then run `st` (defined in B-09).

```bash
mock '{"mode":"error500"}'; sleep 150; st      # 5xx is retried inside the 120 s budget, then fails
mock '{"mode":"forbidden"}'; sleep 90; st
mock '{"mode":"badjson"}'; sleep 90; st
mock '{"mode":"redirect"}'; sleep 90; st       # 302 to http://127.0.0.1:1 (another origin)
mock '{"mode":"normal"}'; sleep 90; st         # recovery
```

Finally re-run B-10's commands (the error paths above wrote `lastSyncError` and sync-run rows) and tick "repeated after B-11" in B-10's RESULT.

**Pass:**

- `error500`, `badjson`, `redirect`: outcome `failed`; `consecutiveFailures` increases and `failing = t`; `synced` timestamp unchanged; `err` names no URL, header or key; for `redirect`, `mock.log` shows no request to port 1.
- `forbidden`: outcome `failed` and `status = permission_denied` (the 403 transition).
- recovery: a clean run sets `status = connected`, clears `consecutiveFailures` and `failing`, and advances `lastSuccessfulSyncAt`; the page returns to "Up to date" (a superseded failure no longer shows "Needs attention", D32).
  **On failure:** record the mode and the observed values; blocks Beta (N9.14-F1).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local e2e stack, worker running the patched safe-http (partial/budget fix)
Evidence:    error500= failed/provider_unavailable (1:15.7), consecutiveFailures 1, failing=t, err "Custom source request failed (provider_unavailable)", synced still t   forbidden= failed/permission_denied (0.5 s each), integration status -> permission_denied, consecutiveFailures 6, failing=t   badjson= failed/bad_response, consecutiveFailures 9, status stays permission_denied   redirect= failed/redirect, consecutiveFailures 12, mock.log requests to port 1 = 0   recovery= status connected, consecutiveFailures 0, failing=f, err empty (no new sync-run row for the recovering run, D32 no-change skip)
Deviations:  Not captured: the UI strings ("Needs attention" while failing, "Up to date" after recovery), and the lastSuccessfulSyncAt value itself was not compared before and after (only that it stayed set). After a 403 the status stays permission_denied through later bad_response and redirect failures until a clean run (observed, plausible by design). No URL, header or key appears in any err text.
```

### B-12 — Lifecycle guard abort, owner override, refused paths (plan 09 §6.4, §6.11; Q11, Q15, R1, R2, U1, U6)

|               |                                                                                    |
| ------------- | ---------------------------------------------------------------------------------- |
| Related       | N9.7 guards, N9.11 override routes, N9.12 `OverridePanel`                          |
| Source        | Plan 09 §6.4 (lifecycle guard aborts only when `R ≥ 10` and `R > 0.25 × L`), §6.11 |
| Why           | No guard or override has run against a database                                    |
| Environment   | E3                                                                                 |
| Prerequisites | B-11 done (mock `normal`, 140 tickets, `L` = 140 live cases)                       |
| State         | Writes `sla_e2e_test`                                                              |
| Depends on    | B-11                                                                               |
| Closes        | End-to-end evidence for the lifecycle guard and the customer override path         |

`closeFirst` closes the first N unsolved mock tickets and stamps them as updated now. With `L = 140` the guard needs `R > 35`; N = 45 is above it and below the 94 unsolved tickets.

```bash
lsql sla_e2e_test <<'SQL'
select count(*) as live_cases, count(*) filter (where "closedAt" is null) as open_cases from cases where system = 'custom' and "deletedAt" is null;
SQL
mock '{"closeFirst":45}'; sleep 90
lsql sla_e2e_test <<'SQL'
select outcome, "reasonCode" from integration_sync_runs order by "startedAt" desc limit 1;
select count(*) filter (where "closedAt" is null) as open_cases from cases where system = 'custom' and "deletedAt" is null;
SQL
```

If `live_cases` is not 140, use N = floor(0.25 × live_cases) + 10 instead of 45.
Then: (a) sign in as **member A** (`n9-member-a@example.test`): the override control must be absent or refused; (b) sign in as **owner A**, open the aborted run, read the preview (guard, `R`, `L`, ratio, record ids), enter a reason, confirm; (c) wait one run and query:

```bash
lsql sla_e2e_test <<'SQL'
select id, guard, path, "consumedAt" is not null as consumed, outcome, "expiresAt" - "createdAt" as ttl from guard_overrides order by "createdAt" desc limit 1;
select count(*) filter (where "closedAt" is null) as open_cases from cases where system = 'custom' and "deletedAt" is null;
SQL
```

(d) Support path without its permission: signed in as the operator (`n9-owner-b@example.test`, in `PLATFORM_ADMIN_EMAILS`, while `GUARD_OVERRIDE_OPERATOR_EMAILS` is empty), run in the browser console `fetch('/api/admin/custom-overrides/<id from (c)>/apply', {method: 'POST'}).then(r => r.status)` and record the status.

**Pass:** after `closeFirst` the run is `aborted` with `mass_lifecycle_change` and **`open_cases` is unchanged** (nothing partly projected); the member cannot override; after the owner's override: `guard = mass_lifecycle_change`, `path = customer`, `consumed = t`, `open_cases` dropped by N; a later identical abort is not cleared by waiting; (d) is refused (403, or 400/409 because the override is already consumed: record which). Record the TTL (proposed 24 h, OD-10).
**On failure:** record the step; blocks Beta.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED   (all measured criteria pass; the member-refusal and preview-contents items were closed 2026-10-10 by Claude Code on a rebuilt stack, see Evidence)
Run by/date: Yasser Alnajjar, 2026-10-10 09:38-09:56 UTC
Where:       local e2e stack, sla_e2e_test, worker on the patched safe-http
Evidence:    L=140   N=90 (the command `closeFirst:45` ran twice, 09:38:09 and 09:38:37; the mock then had 4 open of 140; the guard needs R > 35, so the check still holds)   abort outcome/reason=aborted/mass_lifecycle_change, repeated unchanged on three later runs (09:39:39, 09:40:17, 09:40:55; waiting did not clear it)   open before/after abort=94/94   member refused? [x] yes (see the closing run below)
             override row (guard/path/consumed/ttl)= mass_lifecycle_change / customer / consumed=t, outcome=applied / 23:59:59.971 (24 h, OD-10)   open after override=4 (94 -> 4, equal to the 90 closed at the source; the run after the override was ok, 90 records)   support path status=403 (operator, GUARD_OVERRIDE_OPERATOR_EMAILS empty)
Deviations:  N was 90, not 45 (command run twice). Preview contents (guard, R, L, ratio, record ids) were not reported. The pasted browser output contained a local session cookie of the throwaway e2e database; it was not stored here.
Closing run (Claude Code, 2026-10-10 11:33-11:36 UTC, rebuilt local e2e stack sla_e2e_test, commit 292cb26, worker running, mock reset to 140 tickets): L=140, 94 open; `closeFirst:45` ran once (N=45 > 35); runs at 11:34:48 and 11:35:18 = aborted/mass_lifecycle_change with 45 records, open_cases 94 before and after.
             owner preview (GET /api/integrations/custom/overrides): guard mass_lifecycle_change, R=45, L=140, ratio=0.3214, 20 record ids (T-1001, T-1002, T-1004 ...), previewHash (64 hex).
             member A (n9-member-a@example.test, role member): GET preview, POST customer override and POST support-authorization all returned 403 "Only an organization owner can change this setting"; guard_overrides stayed at 0 rows. The "control absent in the UI" half was not observed (no browser); the server refuses.
             Not repeated (already recorded above): the owner confirmation, TTL and the operator 403.
Deviations (closing run): the dry-run state differs from the first run (rebuilt database, N=45 once). The override was not confirmed in this run, so an aborted pass is left pending in sla_e2e_test.
```

### B-13 — Availability during an in-flight request: allowlist removal aborts within about 5 s, data preserved, pause not resumed (plan 09 §8.7, plan 10 §5.4)

|               |                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N10.3, N10.4, N9 Q5; N10 "Phase is done when" bullet 2 (Custom REST half)                                                        |
| Source        | Plan 09 §8.7 "Turning the flag off"; `docs/integration-availability.md` "In-flight and queued work", "Procedure: Beta allowlist" |
| Why           | The 5-second abort, the discarded response and the pause semantics have only been described                                      |
| Environment   | E3                                                                                                                               |
| Prerequisites | B-12 done; operator account `n9-owner-b@example.test`                                                                            |
| State         | Writes `sla_e2e_test`                                                                                                            |
| Depends on    | B-12                                                                                                                             |
| Closes        | Custom REST half of N10's done-when "disable/re-enable … with no data changed"                                                   |

```bash
snap() { lsql sla_e2e_test <<'SQL'
select md5(string_agg(c::text, '|' order by c.id)) as cases_md5 from cases c where c.system = 'custom';
select md5(string_agg(n.id || n."occurredAt"::text, '|' order by n.id)) as events_md5 from normalized_events n where n.system = 'custom';
select md5(string_agg(m.id || m.status::text, '|' order by m.id)) as commitments_md5 from commitments m join cases c on c.id = m."caseId" where c.system = 'custom';
select status, "pollingPausedAt" is not null as paused, md5(coalesce(cursor::text, '')) as cursor_md5 from integrations where provider = 'custom';
SQL
}
snap > ~/elapsed-validation/b13-before.txt
mock '{"mode":"hang"}'
# Wait until mock.log shows a "hang" line (a request is in flight). Then immediately, as the operator, remove
# organization A from the Custom REST allowlist (/admin/tenants/<org A> panel or /admin/integrations), with a reason.
sleep 20
lsql sla_e2e_test <<'SQL'
select outcome, "reasonCode", "finishedAt" from integration_sync_runs order by "startedAt" desc limit 1;
select action, "createdAt" from admin_audit_logs order by "createdAt" desc limit 1;
SQL
snap > ~/elapsed-validation/b13-after.txt; diff ~/elapsed-validation/b13-before.txt ~/elapsed-validation/b13-after.txt
mock '{"mode":"normal"}'
```

Then: try **re-adding** organization A in the console (allowed under D33-A1 while Custom REST is Beta with an allowlist; it must still not resume polling); re-add it in this disposable database only by re-running `pnpm --filter @sla/web exec tsx scripts/seed-n9-test-orgs.ts`; after two worker runs confirm `paused` is still `t` (re-adding does not resume); finally use **Resume polling** on the tenant page and confirm the next run ingests (`lastSuccessfulSyncAt` advances).
**Pass:** the run ends `aborted` with `flag_disabled`, and `finishedAt` minus the audit row's `createdAt` is ≤ **10 s** (documented: about 5 s); the audit action is `remove_integration_allowlist`; the `diff` shows only `paused` changing (`f` → `t`): cases, events, commitments and cursor identical; case pages still show the data with the stale / "Paused by Elapsed" marker; re-adding does not resume; Resume polling does.
**On failure:** record which property failed.

```text
RESULT
Status:      [x] PASS (with the caveats under Deviations)   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 10:08-10:21 UTC
Where:       local e2e stack, sla_e2e_test, worker on the patched safe-http
Evidence:    abort outcome/reason= aborted/flag_disabled (run started 10:10:20, ended 10:11:45.852)   finishedAt - audit = 1.4 s (audit remove_integration_allowlist at 10:11:44.409)   diff= events_md5 identical, cursor_md5 identical, `paused` f -> t, cases_md5 differed (see Deviations)
             console re-add= not reported   paused after re-add= t (seed script re-added the allowlist row; paused stayed t, no new run)   resume ingests? [x] yes: Resume polling -> paused=f, lastSuccessfulSyncAt advanced 10:08:05 -> 10:20:16 (no new sync-run row: no-change run, D32)
Deviations:  (1) cases_md5 changed across the removal because that hash covers whole case rows including `updatedAt`, and the worker rewrites every case's `updatedAt` on every 30 s cycle even while the integration is paused (observed: 10:14:16 -> 10:14:46 with `cases_content_md5` identical and no sync run). A content-only comparison (updatedAt excluded) was identical over that interval but was not repeated across a fresh removal. (2) Observation: the 30 s rewrite of `cases.updatedAt` for every case, with no data change, is wasteful and would make an `updatedAt`-based freshness cue unreliable. (3) The hung request used its full 30 s limit and was recorded failed/timeout (10:08:35), which is correct (not clipped by the budget). (4) The console re-add refusal was not recorded; B-15 covers the same block.
```

### B-14 — Built-in provider disable/re-enable preserves data and shows "Paused by Elapsed" (N10 done-when)

|               |                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N10.2, N10.5, N10.6; N10 "Phase is done when" bullets 2 and 4; D33 "Preservation"                                                                                                                                                                                                                                                                                |
| Source        | Plan 10 §6.1–§6.3; `docs/integration-availability.md` "What is never touched"                                                                                                                                                                                                                                                                                    |
| Why           | The existing-provider half of N10's done-when has no evidence in the repository (N10.7's suites are on `testing-n10` only)                                                                                                                                                                                                                                       |
| Environment   | E3                                                                                                                                                                                                                                                                                                                                                               |
| Prerequisites | B-08. **Stop the worker (terminal 3) before seeding and keep it stopped**: the fixture organization carries fake Zendesk and Jira tokens and a worker run would call the real provider APIs with them. The worker-side skip for built-in providers is covered by B-06 (`apps/worker/test/integration-availability.test.ts`); the Custom REST worker path by B-13 |
| State         | Writes `sla_e2e_test` (fixture seed)                                                                                                                                                                                                                                                                                                                             |
| Depends on    | B-08 (independent of B-09–B-13; run it after them so the worker can stay stopped)                                                                                                                                                                                                                                                                                |
| Closes        | Existing-provider half of N10 done-when bullet 2 and bullet 4                                                                                                                                                                                                                                                                                                    |

```bash
source ~/elapsed-validation/e2e.env
pnpm --filter @sla/worker exec tsx scripts/seed-test-customers/cli.ts seed --tenants=halcyon
zsnap() { lsql sla_e2e_test <<'SQL'
select md5(string_agg(i::text, '|' order by i.id)) as integrations_md5 from integrations i where provider in ('zendesk', 'jira');
select md5(string_agg(c::text, '|' order by c.id)) as cases_md5 from cases c where c.system = 'zendesk';
select md5(string_agg(n.id || n."occurredAt"::text, '|' order by n.id)) as events_md5 from normalized_events n where n.system in ('zendesk', 'jira');
select md5(string_agg(m::text, '|' order by m.id)) as commitments_md5 from commitments m join cases c on c.id = m."caseId" where c.system = 'zendesk';
select md5(string_agg(r.id, '|' order by r.id)) as raw_md5 from raw_events r join integrations i on i.id = r."integrationId" where i.provider in ('zendesk', 'jira');
select provider, status, count(*) from integrations where provider in ('zendesk', 'jira') group by 1, 2;
SQL
}
zsnap > ~/elapsed-validation/b14-0.txt
```

1. As the operator in `/admin/integrations`: read the impact preview for **disabling Zendesk**, record the counts, disable it with a reason and a customer message.
2. Open the fixture organization's integrations page (sign in as one of its seeded users if the seed records credentials, otherwise view it through `/admin/tenants/<id>`): the Zendesk card must say **"Paused by Elapsed"** with the message, not "Disconnected"; a connect attempt for Zendesk in a non-fixture organization (owner A) is refused with the `integration_disabled` notice.
3. `zsnap > ~/elapsed-validation/b14-1.txt`; re-enable Zendesk with a reason; `zsnap > ~/elapsed-validation/b14-2.txt`.

```bash
diff ~/elapsed-validation/b14-0.txt ~/elapsed-validation/b14-1.txt; diff ~/elapsed-validation/b14-0.txt ~/elapsed-validation/b14-2.txt
lsql sla_e2e_test <<'SQL'
select action, metadata ? 'reason' as has_reason, "createdAt" from admin_audit_logs where action = 'update_integration_availability' order by "createdAt" desc limit 2;
select provider, enabled, version from integration_availability where provider = 'zendesk';
SQL
```

**Pass:** both diffs empty (integration rows, `status` included, cases, events, raw events and commitments unchanged); two `update_integration_availability` audit rows with a reason; `version` increased by 2 and `enabled = t` at the end; the card shows "Paused by Elapsed" while disabled and its normal state after; the connect attempt is refused.
**On failure:** record which checksum changed; N10 done-when stays open.

```text
RESULT
Status:      [x] PASS (data preservation, audit and version); UI items not captured   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 10:24-10:28 UTC
Where:       local e2e stack, sla_e2e_test, fixture tenant `halcyon` (1 Zendesk + 1 Jira integration, connected), worker stopped
Evidence:    impact preview= not reported   diff(0->1)= identical (taken while Zendesk was disabled: integrations, cases, events, commitments and raw events unchanged, both integrations still `connected`)   diff(0->2)= identical (after re-enable)   audit rows= 2 `update_integration_availability`, both with a reason (10:27:20, 10:27:54)   version/enabled= 2 / t   card while disabled= not reported   connect refused? [ ] not reported
Deviations:  The first baseline attempt was empty (helper functions missing in that tab) and was retaken before any change. Not captured: the impact-preview counts, the "Paused by Elapsed" card text, the owner A connect refusal. The worker-side skip for built-in providers rests on B-06 (apps/worker/test/integration-availability.test.ts).
Follow-up 2026-10-10 (Claude Code, rebuilt local e2e stack sla_e2e_test, worker stopped, operator = n9-owner-b via the API, not the browser): impact preview POST /api/admin/integrations/providers/zendesk/impact {"enabled":false} = {"organizationsLosingAccess":[],"connectionsAffected":0} (this database has no Zendesk connection); PATCH disable with a reason and status message = 200, version 0 -> 1; owner A GET /api/integrations/zendesk/connect?subdomain=acme = 307 to /settings/integrations?availability=integration_disabled&provider=zendesk (connect refused); PATCH re-enable with a reason = 200, version 2, enabled=t; 2 `update_integration_availability` audit rows with a reason. After re-enable, the same connect request passes the availability gate and returns 500 "Zendesk is not configured for this organization" (the local database has no Zendesk OAuth client; not a defect of the gate).
             Still not verified: the "Paused by Elapsed" card text and the 'not Disconnected' rendering (browser-only), and data preservation across the disable (this database has no Zendesk data; the earlier fixture run above stands).
```

### B-15 — Custom REST rollout block (N9.14-F1 enforced by the backend; amended by D33-A1)

|               |                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N10.4, D33 ruling 3 as amended by D33-A1 (2026-10-10), N9.14-F1                                                                                      |
| Source        | Plan 10 §5.4 "Rollout block", ruling 3-A1; `docs/integration-availability.md` "Rollout block: Custom REST"; `packages/db/src/integration-catalog.ts` (`N9.14-F1`) |
| Why           | The block is the only thing that keeps Custom REST from being opened to all organizations or promoted to Stable before its gate; the allowlist stays the bounded, operator-controlled form of Beta |
| Environment   | E3                                                                                                                                                   |
| Prerequisites | B-08; the E2E web stack running the D33-A1 code (branch `e2e/d33-allowlist-policy`; restart the web server after switching)                           |
| State         | Writes `sla_e2e_test`: one allowlist add, one narrowing change (and the cleanup below)                                                              |
| Depends on    | B-08                                                                                                                                                 |
| Closes        | Evidence that N9.14-F1 still blocks All organizations and Stable, and that an allowlist add is scoped to one organization and audited               |

**Policy under test (D33-A1).** While `stage = beta` and `access = allowlist`, an operator can add or remove individual organizations. Opening to **All organizations** and promoting to **Stable** stay refused with `rollout_blocked` (409) until N9.14-F1 closes.

Take the **before** snapshot first (helper tab):

```bash
lsql sla_e2e_test <<'SQL' | tee ~/elapsed-validation/b15-before.txt
select a."organizationId", o.name from integration_beta_allowlist a join organizations o on o.id = a."organizationId" where a.provider = 'custom' order by o.name;
select "releaseStage", "betaAccess", enabled, "statusMessage", version from integration_availability where provider = 'custom';
select count(*) as audit_rows_before from admin_audit_logs where metadata::text like '%custom%';
SQL
```

Then, in `/admin/integrations` → Custom REST, as the operator (`n9-owner-b@example.test`):

1. **Allowed:** click **Allowlist**, choose organization B, enter a reason, **Add to allowlist**. Expect success (HTTP 201).
2. **Refused:** open **Edit availability**: **All organizations** and **Stable** are disabled in the dialog, so send each change to the API from the browser console (same session; set `v` to the `version` from the snapshot):

```js
const v = 0; // replace with the current version
for (const change of [{ betaAccess: "all_organizations" }, { releaseStage: "stable" }]) {
  const r = await fetch("/api/admin/integrations/providers/custom", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: v, reason: "B-15 refused attempt", ...change }),
  });
  console.log(JSON.stringify(change), r.status, await r.text());
}
```

   Record each status and body.
3. Run the **after** queries (before the narrowing test):

```bash
lsql sla_e2e_test <<'SQL'
select a."organizationId", o.name, a."addedByEmail" from integration_beta_allowlist a join organizations o on o.id = a."organizationId" where a.provider = 'custom' order by o.name;
select "releaseStage", "betaAccess", enabled, "statusMessage", version from integration_availability where provider = 'custom';
select action, "organizationId", "createdAt", metadata::text from admin_audit_logs where metadata::text like '%custom%' order by "createdAt" desc limit 5;
select count(*) as audit_rows_after from admin_audit_logs where metadata::text like '%custom%';
SQL
```

4. **Narrowing:** **Edit availability**, set only a status message, reason, save. Then re-run the last query only.
5. **Cleanup (optional, recommended before B-16):** remove organization B from the allowlist in the console (one more audit row) and clear the status message (one more), so the allowlist is organization A only again.

**Pass:** (1) succeeds with 201 and writes exactly **one** `add_integration_allowlist` audit row whose `organizationId` is B; the allowlist is then exactly the before set plus B, and no other organization is added; `releaseStage`, `betaAccess`, `enabled` and `version` are unchanged by the add. (2) both PATCH attempts return **409 `rollout_blocked`** with the N9.14-F1 reason, and `stage` stays `beta`, `access` stays `allowlist`, `version` is unchanged and no audit row exists for them (the audit count rose by exactly 1 since the before snapshot). (3) the narrowing change succeeds, writes one `update_integration_availability` row and raises `version` by 1.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 10:42-10:49 UTC
Where:       local e2e stack, sla_e2e_test, web on branch e2e/d33-allowlist-policy (D33-A1), worker stopped
Evidence:    (1) add org B = success, one add_integration_allowlist audit row for B at 10:42:30, allowlist = A + B only
             (2a) all_organizations = 409 rollout_blocked (N9.14-F1 reason)   (2b) stable = 409 rollout_blocked (N9.14-F1 reason)
             stage/access/version unchanged? [x] (beta / allowlist / 0)   audit rows before/after = 2 / 3 (before inferred, see Deviations)
             (3) narrowing (status message) = success, update_integration_availability row at 10:48:39, version 0 -> 1, audit count 4
             cleanup: B removed and status message cleared; allowlist = A only, version 2
Deviations:  The before snapshot was not taken. The before count of 2 is inferred from the audit rows that predate B-15 (B-13's remove_integration_allowlist and resume_polling). No audit row exists for either refused attempt. The two refused changes were sent from the browser console because the dialog disables those options.
```

### B-16 — Unsupported commitment kinds: dry-run, confirmation, cancellation, rollback guard (plan 09 §5.5, §5.6; Q14, R5, U3 option (a))

|               |                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Related       | N9.8a, N9.11 activation/rollback, N9.12 `ImpactPanel`                                                  |
| Source        | Roadmap N9.8a ("Not run: … the dry-run/confirm UI and the activation transaction"); plan 09 §5.5, §5.6 |
| Why           | The first code that cancels `first_response`/`resolution` commitments has never run                    |
| Environment   | E3                                                                                                     |
| Prerequisites | B-09 PASS (version 1, `slaMode: "full"`, commitments of all three kinds)                               |
| State         | Writes `sla_e2e_test`                                                                                  |
| Depends on    | B-09 (run after B-12/B-13 so their data is settled; resume polling first)                              |
| Closes        | End-to-end evidence for N9.8a; U3 option (a) enforcement                                               |

```bash
lsql sla_e2e_test <<'SQL' > ~/elapsed-validation/b16-before.txt
select m.kind, m.status, count(*) from commitments m join cases c on c.id = m."caseId" where c.system = 'custom' group by 1, 2 order by 1, 2;
select md5(string_agg(m::text, '|' order by m.id)) as finalized_md5 from commitments m join cases c on c.id = m."caseId" where c.system = 'custom' and m.status in ('met','breached') and m."closedAt" is not null;
select count(*) as evaluations from evaluations e join commitments m on m.id = e."commitmentId" join cases c on c.id = m."caseId" where c.system = 'custom';
SQL
```

1. Edit from active (Advanced JSON): change `"slaMode": "full"` to `"slaMode": "resolution_only"`; validate; **Activate**. Read the dry-run: counts per kind and status of commitments to cancel, and the statement that rollback does not undo cancellation. Record the counts, then **confirm**.
2. Re-run the query into `b16-after.txt`; also `select action, "fromVersion", "toVersion", details from custom_activation_audits order by "createdAt" desc limit 1;`.
3. Try **Roll back** to version 1 (which re-supports `next_reply`). Record the response.
4. Activate version 2 again (no change) and confirm nothing else is cancelled.

**Pass:** the dry-run wrote nothing (counts identical until you confirm); after confirmation only unfinalized `first_response` and `next_reply` commitments became `cancelled`, matching the dry-run counts; `finalized_md5` and the evaluation count are identical; nothing deleted; an activation audit row with the counts and preview hash; the rollback to version 1 is **refused** (U3 option (a)); step 4 cancels 0.
**On failure:** blocks Beta; record the counts.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar (executed by Claude Code from the cloud session), 2026-10-10
Where:       cloud-session e2e stack: local Postgres 16 (no Docker), sla_e2e_test, branch claude/sharp-euler-gm4not, mock helpdesk with 140 tickets, rebuilt via B-08 and B-09 (API-driven, not browser)
Evidence:    dry-run counts= 19 next_reply (all breachedOpen), 0 first_response, 140 finalized kept; DB identical to b16-before until confirmation
             after (by kind/status)= first_response met 140; next_reply cancelled 19; resolution on_track 19, met 46, breached 75   finalized_md5 same? [x] (241d07bd...)  evaluations same? [x] (299)
             audit row= activate 1->2, previewHash 7062d94e..., cancelledByKind {next_reply:19}, keptFinalized 140   rollback to v1= refused, 409 next_reply_restore_blocked (active version stayed 2)   re-activate cancels= 0 (new version 3, previewHash null, DB identical to after)
Deviations:  The cloud session has no Docker, so psql against a local Postgres replaced ldc/lsql. B-09 was rebuilt through the API (policy, draft, test, sample, preview, validate, activate) and not the browser; the dry-run/confirm UI (ImpactPanel) was not exercised. In this dataset no unfinalized first_response commitments existed (all 140 met), so only next_reply was cancelled; first_response cancellation is not covered. Step 4 produced version 3, not 2 (every activation creates a new version).
```

### CHECKPOINT B

Required for the release (C-11): **B-01, B-02, B-03, B-07 PASS** (with only the three known failures in B-07). Required for any Custom REST Beta activation (N9.14-F1): additionally B-05, B-06, B-09–B-16 PASS and D-01, D-07, D-08, OD-01. A FAIL in B-10, B-12 or B-13 is a security or data-safety finding: stop and send the file back.

```text
CHECKPOINT B:  [x] release prerequisites met (B-01, B-02, B-03, B-07 PASS; 2026-10-10)   [ ] Beta prerequisites met   [ ] stopped — reason:
```

Status 2026-10-10 (updated after B-07): release prerequisites B-01, B-02, B-03 and B-07 are PASS, so that box is ticked; C-11 still needs C1 and the owner's gate (OD-05). The Beta box stays open. Beta prerequisites: B-05, B-06, B-08 to B-16 have PASS results (B-10, B-12, B-14 carry the browser limitation recorded in their Deviations). Update after the 2026-10-10 follow-up: D-01 benchmark RUN, result C = 1,000 on the pinned 2-CPU host and the provisional 5,000 fails (waiting for OD-08 and a decision on the result); D-07 review package prepared, BLOCKED on the reviewer (BL-09); D-08 partly done (13 files, 451 tests; row 12 and unit-level parts of others still missing); OD-01 analysis and recommendation written (§2.5), undecided. None of the four is closed, so the Beta box stays open.
Status 2026-10-10 (after the owner decisions OD-08 and OD-01): D-01 is a PASS as a provisional Beta safeguard only (C = 1,000, ceiling default and worker Compose wiring in the repository, not deployed); OD-01 is decided (option (b), pilot only) with the operator procedure and specific messages in place; D-07 is still BLOCKED on the qualified reviewer (BL-09: not marked complete, live legal text unchanged); D-08 is still PARTIAL (rows 2, 4, parts of 11, 12 and 14 lack dedicated tests; tests are not yet on `testing`). The Beta box stays OPEN. Precise remaining Beta gate: (1) D-07 qualified legal review and its decision record; (2) D-08 remaining rows and the tests integrated into `testing` after the owner authorizes the branch sync; (3) the deployment of the ceiling configuration and its verification on the host (owner action; steps reported separately); (4) the remaining N9.14-F1 items not covered by Phase B (the allowlist code change lifting the rollout block is a separate reviewed change). The real-host benchmark gates raising the ceiling, not Beta at 1,000.
Status 2026-10-10 (final engineering pass): rollout block traced: `INTEGRATION_CATALOG.custom.rolloutBlock` (N9.14-F1) forbids only opening Custom REST to all organizations or promoting it to Stable; adding individual organizations to the Beta allowlist is allowed while it is in place (`allowlistAddBlock`; tests in `apps/web/test/integration-availability-admin.test.ts` and `packages/db/test/integration-availability.test.ts`, which also assert the block stays). So it does NOT block a pilot, and the approved policy lifts it only in a reviewed change after N9.14-F1 closes, which includes the legal review (D-07). It was therefore left in place; only its reason text was refreshed. Criteria check against code, tests and configuration: (1) B-01..B-16: PASS (results above); (2) D-01: PASS as provisional safeguard, ceiling 1,000 in code, Compose and docs, tested; (3) OD-01: decided, runbook, specific messages and tests in place; (4) `GUARD_OVERRIDE_OPERATOR_EMAILS` and the ceiling wired and tested in Compose (not deployed); (5) D-08: code-side met, `testing` integration not done (see D-08 follow-up 3); (6) D-07: reviewer sheet `implementation-plans/n9-legal-decision-sheet.md` prepared, decisions outstanding. Beta box stays OPEN on exactly: D-07 reviewer decisions (and owner decisions O-1 to O-3 in the sheet), the `testing` integration, and the production deployment and verification of the two Compose settings.
Status 2026-10-10 (final closure): D-08 is closed (tests on `testing` 23f265b and `main` b533624, 598 focused tests pass). The legal sheet `implementation-plans/n9-legal-decision-sheet.md` now separates owner decisions O-1 to O-3 (Part A) from the clauses only a qualified reviewer may decide (Part B); D-07 stays BLOCKED (BL-09) until the reviewer's decisions are recorded in `n9-legal-review.md` section 6. Deployment and rollback commands for the two Compose settings, with post-deployment verification, are prepared in `docs/custom-beta-deployment.md` and NOT executed (awaiting explicit production-deployment approval; note they only take effect with the N2 to N10 release, C-11/OD-05). The Beta box remains OPEN on: D-07 reviewer decisions, owner decisions O-1 to O-3, and the approved production deployment and verification. Phase C has not been started.
Status 2026-10-10 (owner decisions O-1, O-2, O-3 recorded; O-2 updated later the same day): O-1 = Option A, O-2 = Option A (no fixed-egress-IP requirement for the initial launch; earlier same-day Option B superseded; fixed-egress work and verification deferred indefinitely), O-3 = Option A, approved by the owner in writing in the session; recorded in `implementation-plans/n9-legal-decision-sheet.md` and mirrored in `n9-legal-review.md`. Legal review stays PENDING; live Terms and Privacy unchanged; no fixed-IP commitment is made to customers; no retention purge will be built; the rollout block is untouched; the Elastic IP 13.62.74.24 is unchanged; no code, test, `testing` or production change was made for this update.

---

## 6. Phase C — Server validation

Phase C has three stages. **C1 (C-01–C-10)** works on copies: a read-only production dump, a scratch database on the host, and a restore on your machine. **C2 (C-11)** is the gated production release. **C3 (C-12–C-18)** verifies production afterwards and runs the gated host repairs.

Set these once on your machine for C-03–C-10 and C-14 (customer data: keep the directory private):

```bash
mkdir -p ~/elapsed-validation/replay && chmod 700 ~/elapsed-validation/replay
export DRILL_URL="postgresql://user:password@localhost:5432/sla_restore_drill?schema=public"   # the replay tools refuse any other database name
export MAIN_SHA=$(git rev-parse origin/main)     # the commit you validated in Phase B
export PROD_SHA=<from A-03>
```

### C-01 — Fresh production backup and off-host copy

|               |                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Related       | Release prerequisite; N2.10/N2.11; H-13; D24 replay input                                                                      |
| Source        | `docs/production-backup-runbook.md` §1–§3; `h-phase-close-out.md` Release row ("Back up first")                                |
| Why           | Every C1 check runs on this dump; it is also the rollback point for C-11                                                       |
| Environment   | E6 · PRODUCTION (`pg_dump` reads; the dump file is written to the host disk)                                                   |
| Prerequisites | CHECKPOINT A; disk space (A-08)                                                                                                |
| State         | READ-ONLY on the database; writes `backups/pre-validation-elapsed_db-<STAMP>.dump` (the `pre-` prefix is never pruned by cron) |
| Depends on    | A-03, A-07, A-08                                                                                                               |
| Closes        | Input for C-02–C-10                                                                                                            |

```bash
# on the host (helpers from §0.4)
mkdir -p backups && chmod 700 backups && umask 077 && STAMP=$(date -u +%Y%m%dT%H%M%SZ) && \
  dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner' sh "$APP_DB" < /dev/null \
  > "backups/pre-validation-elapsed_db-$STAMP.dump" && echo "backups/pre-validation-elapsed_db-$STAMP.dump"
ls -lh backups/pre-validation-elapsed_db-*.dump | tail -1
dc exec -T postgres pg_restore --list < "backups/pre-validation-elapsed_db-$STAMP.dump" | grep -c "TABLE DATA"
ro_sql <<'SQL'
select (select count(*) from cases) as cases, (select count(*) from integrations) as integrations, (select count(*) from _prisma_migrations) as migrations;
SQL
```

On your machine:

```bash
scp -i /path/to/your-key.pem "ubuntu@13.62.74.24:~/elapsed/backups/pre-validation-elapsed_db-<STAMP>.dump" ~/elapsed-validation/replay/
```

**Pass:** a dump of several MB; `TABLE DATA` count equals the live table count (A-07); the live counts recorded; the copy is on your machine. `DUMP_TS` = the stamp as ISO (`20261009T120000Z` → `2026-10-09T12:00:00Z`).
**On failure:** a KB-sized dump means the wrong database: check `APP_DB`, stop.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:40 UTC
Where:       host
Evidence:    dump=backups/pre-validation-elapsed_db-20261010T074145Z.dump   size=256 KB   TABLE DATA=44   live cases=24   integrations=2   migrations=68   DUMP_TS=2026-10-10T07:41:45Z
             off-host copy done? [x] yes (copied to ~/elapsed-validation/replay/ on the local machine; restore in C-03 succeeded)
             live public tables=44 (equals TABLE DATA; confirmed 2026-10-10)
Deviations:  None. Size is KB-range because production now holds 1 organization and 24 cases (earlier dumps held about 12 organizations).
```

### C-02 — Host restore drill with recorded timing (closes the 7.3 evidence gap)

|               |                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related       | 7.3, Launch Gate "Backups tested by a real restore", DC-07                                                                                                                           |
| Source        | `docs/deployment.md` "Test the restore"; `scripts/restore-drill.sh`; roadmap 7.3 ("add the line if it isn't committed yet")                                                          |
| Why           | The recovery-time figure was never committed                                                                                                                                         |
| Environment   | E6 · PRODUCTION host, **scratch database `sla_restore_drill` only** (the script never touches `elapsed_db` and never stops web or worker)                                            |
| Prerequisites | C-01; no other `sla_restore_drill` on the host that you still need (the script drops it at start and exit)                                                                           |
| State         | Creates and drops `sla_restore_drill` in the production Postgres instance (CPU and I/O for the restore duration); appends one line to `docs/restore-drills.log` in the host checkout |
| Depends on    | C-01                                                                                                                                                                                 |
| Closes        | 7.3 evidence (after you commit the log line)                                                                                                                                         |

```bash
COMPOSE_FILE=docker-compose.yml ENV_FILE="$ENV_FILE" scripts/restore-drill.sh "backups/pre-validation-elapsed_db-<STAMP>.dump"
tail -1 docs/restore-drills.log
```

**Pass:** the script prints `drill: … restore_seconds=<n> tables=<t> cases=<c>` with `cases` equal to C-01's live count (± rows written since the dump) and `tables` ≥ the `TABLE DATA` count. Copy the line into `docs/restore-drills.log` in your own checkout and commit it (E-03), then `git checkout -- docs/restore-drills.log` on the host if you do not want a modified host tree before C-11.
**On failure:** the script exits non-zero and drops the scratch database; record the message.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10 07:44 UTC
Where:       production host, scratch database sla_restore_drill, commit 8dc2fe8
Evidence:    drill line= 2026-10-10T07:44:43Z dump=pre-validation-elapsed_db-20261010T074145Z.dump size=256K restore_seconds=1 tables=44 cases=24
Deviations:  `docs/restore-drills.log` now exists only in the host checkout (uncommitted; the host working tree is no longer clean). The line still has to be added to the repository (7.3).
```

### C-03 — Restore the dump into `sla_restore_drill` on your machine

|               |                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Related       | D24 replay gate; N2.11; N3–N10 shared changes                                                     |
| Source        | `docs/n2-replay-runbook.md` §1; roadmap Rev 7 (2026-10-05 local restore of the production backup) |
| Why           | The replay needs a restore that is not on the production host                                     |
| Environment   | E4 (restored production data on an isolated local database)                                       |
| Prerequisites | C-01 copy; local Docker Postgres                                                                  |
| State         | Creates `sla_restore_drill` locally (customer data)                                               |
| Depends on    | C-01                                                                                              |
| Closes        | Input for C-04–C-10                                                                               |

```bash
ldc exec -T postgres dropdb -U user --if-exists sla_restore_drill && ldc exec -T postgres createdb -U user sla_restore_drill
ldc exec -T postgres pg_restore -U user -d sla_restore_drill --no-owner --exit-on-error < ~/elapsed-validation/replay/pre-validation-elapsed_db-<STAMP>.dump
lsql sla_restore_drill <<'SQL'
select (select count(*) from cases) as cases, (select count(*) from integrations) as integrations, (select count(*) from _prisma_migrations) as migrations,
       (select migration_name from _prisma_migrations order by started_at desc limit 1) as newest;
SQL
```

**Pass:** no restore error; counts equal C-01's live counts; `newest` equals A-04's newest.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local (docker-compose.dev.yml postgres), database sla_restore_drill
Evidence:    cases=24   integrations=2   migrations=68   newest=20261009120000_n10_integration_availability (all equal to C-01 and A-04)
Deviations:  None.
```

### Rework of C-04 to C-10 for an already-released production (2026-10-10)

A-04 showed all 68 migrations applied in production, so the 2026-10-10 dump (C-01) is **already at `main`'s schema**. The original C-04 to C-08 flow (capture with the deployed code, then migrate, then capture with `main`) has nothing to migrate on it. Run C-03 as written (it verifies the restore of the current dump), then run C-04 to C-10 **unchanged except for the overrides below**, on the last pre-release dump, which still holds the pre-release schema and a larger dataset:

| Item | Original text | Use instead |
| --- | --- | --- |
| Dataset | `pre-validation-elapsed_db-<STAMP>.dump` | `~/elapsed/backups/sla-20261001T104033Z.dump` on the host (4.5 MB, 29 tables, A-07). Copy it to `~/elapsed-validation/replay/` like C-01 and restore it into `sla_restore_drill` with the C-03 commands (replacing the current restore) |
| `DUMP_TS` | stamp of C-01 | `2026-10-01T10:40:33Z` |
| `PROD_SHA` (C-04 base) | A-03's deployed commit | `7cb2b9b` (the code that produced that dump; has `replay:capture`, `replay:compare`, `backfill:breached-at`) |
| `MAIN_SHA` | current `main` | unchanged (`0e48d28` code, or the current `main`) |
| C-05 pass | applies A-04's pending list | applies exactly the migrations newer than the restore's newest, in order (expected: the 13 listed in A-04's old expectation, `20261001100000` ... `20261009120000`) and not `20261001110000_contract_customer_identity_and_case_source`; then `diff exit=0` |
| C-08 pass | counts as written | Counts reflect the October 1 data (fixture organizations present), so record them rather than comparing with today's production |

**C-05b (new, on the current dump after the C-04 to C-10 sequence):** restore the 2026-10-10 dump with the C-03 commands, then confirm that production's schema equals `main`'s:

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate deploy        # expect "No pending migrations"
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "diff exit=$?"
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of 2026-10-10T07:41:45Z --out ~/elapsed-validation/replay/current.jsonl
```

**Pass:** no pending migration, `diff exit=0`, the capture finishes (record records and the drift line). Record under C-05's RESULT block as "C-05b".

```text
RESULT (C-05b)
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Evidence:    pending=0 ("No pending migrations to apply", 68 migrations found)   diff exit=0 ("No difference detected")
             capture: 58 commitments, 24 cases, 1 organization as of 2026-10-10T07:41:45Z; C-class drift 0 status, 0 breachedAt of 58
Deviations:  main worktree was 8dc2fe8 (docs-only change over 0e48d28). Drift is already 0/0, so the 9 breachedAt rows in H-13 are no longer present in production data (C-13/C-10 expectation changes; see C-10 on the old dump).
```

### C-04 — L1 baseline with the deployed code

|               |                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | D24; N2.11 ("re-run this replay"); N9.3/N9.8a/N9.9/N9.10/N9.13/N9.15 "D24 replay"; N10.3 (worker path)                                                      |
| Source        | `docs/n2-replay-runbook.md` §2; `packages/commitments/src/scripts/replay-capture.ts` (`--as-of`, `--out`; refuses databases other than `sla_restore_drill`) |
| Why           | The baseline must come from the code production runs, before any migration                                                                                  |
| Environment   | E4                                                                                                                                                          |
| Prerequisites | C-03; `PROD_SHA` from A-03                                                                                                                                  |
| State         | Read-only on `sla_restore_drill`; writes the capture file (customer data)                                                                                   |
| Depends on    | C-03                                                                                                                                                        |
| Closes        | Input for C-07                                                                                                                                              |

```bash
git worktree add ~/elapsed-validation/base "$PROD_SHA" && cd ~/elapsed-validation/base
pnpm install --frozen-lockfile && DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db generate
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <DUMP_TS> --out ~/elapsed-validation/replay/baseline.jsonl
cd - && sha256sum ~/elapsed-validation/replay/baseline.jsonl
```

**Pass:** the capture finishes and prints its record count and the line `C-class drift (recomputed vs persisted): <s> status, <b> breachedAt of <n> commitment(s)`. **Expected drift before H-13 is repaired: 0 status and 9 `breachedAt`** (roadmap H-13). Record all three numbers.
**On failure:** if `PROD_SHA`'s `replay:capture` does not exist or fails, record it and stop (the deployed code may predate N1.1).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, base=7cb2b9b (code of that dump), dump of 2026-10-01
Evidence:    records: 3,923 commitments, 1,517 cases, 12 organizations   drift status=0   drift breachedAt=9   of commitments=3923
             sha256=c180d2225611892f3b6b719791e3279fd8030fde1f6d181685fc452d403ac011
Deviations:  Run on the 2026-10-01 dump (rework note) because the 2026-10-10 dump is already post-release.
```

### C-05 — Apply the pending migrations to the restore with `main`

|               |                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Related       | Release N2–N10; DC-05; N9.5 ("not applied to a database"), N10.1 (fold of `customProviderEnabled`)   |
| Source        | `h-phase-close-out.md` Release row; `n2-replay-runbook.md` §3                                        |
| Why           | The 6 N9/N10 migrations have never been applied on top of production data                            |
| Environment   | E4                                                                                                   |
| Prerequisites | C-04                                                                                                 |
| State         | Migrates `sla_restore_drill`                                                                         |
| Depends on    | C-04                                                                                                 |
| Closes        | Migration-safety evidence for the release (replaces the 2026-10-05 evidence for 7 migrations, DC-05) |

```bash
cd /path/to/elapsed && git worktree add ~/elapsed-validation/main "$MAIN_SHA" && cd ~/elapsed-validation/main
pnpm install --frozen-lockfile && DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db generate
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate deploy 2>&1 | tee ~/elapsed-validation/replay/migrate.log
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "diff exit=$?"
```

**Pass:** `migrate deploy` applies exactly A-04's pending list, in order, and **not** `20261001110000_contract_customer_identity_and_case_source`; no error; `diff exit=0`.
**On failure:** paste the failing migration and error; stop: the release cannot proceed.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, main=8dc2fe8 (code of 0e48d28 plus docs), on the 2026-10-01 dump
Evidence:    applied (names)= 20261001100000_sla_import_summary_provider, 20261001120000_provider_freshness, 20261002100000_platform_admin_and_plan_records, 20261002140000_n5_onboarding_and_retention, 20261003100000_n6_entitlements, 20261003120000_normalized_event_source_raw_event_index, 20261004100000_n6_internal_billing, 20261009100000_n9_custom_ticket_provider, 20261009100100_n9_guard_override, 20261009100200_n9_custom_integration_provider, 20261009100300_n9_custom_activation_audit, 20261009110000_n9_last_data_changed_at, 20261009120000_n10_integration_availability (13, in order; contract migration 20261001110000 not applied)
             diff exit=0 ("No difference detected")
Deviations:  Migrated the 2026-10-01 restore (rework note). This is migration-safety evidence on 12 organizations and 1,528 cases; production itself had already applied the same 13.
```

### C-06 — L2 normalization replay (twice)

|               |                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Related       | D24; N2.3/N2.11; N9.15 projector change counts (D32: "replay must show 0 differences")                                             |
| Source        | `docs/n2-replay-runbook.md` §3; `apps/worker/scripts/l2-replay.ts` (`--out-dir`; refuses databases other than `sla_restore_drill`) |
| Why           | The projector and adapters changed after the last L2 (2026-10-01)                                                                  |
| Environment   | E4                                                                                                                                 |
| Prerequisites | C-05                                                                                                                               |
| State         | Writes `sla_restore_drill` (re-normalization) and fingerprint files                                                                |
| Depends on    | C-05                                                                                                                               |
| Closes        | L2 half of the D24 gate for the release                                                                                            |

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2a
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2b
```

**Pass (both runs):** `differences` 0, `recordFailures` 0, `normalizedEventIds` identical; record the record count (2026-10-01: 7,413). `INTEGRATION_TOKEN_ENCRYPTION_KEY=x` follows the runbook: normalization reads stored raw events, not credentials.
**On failure:** any difference stops the release; classify it under D24 (plan 01 §5) before anything else. Do not continue to C-11.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, main=8dc2fe8, on the migrated 2026-10-01 restore
Evidence:    run 1: records=7413   differences=0   recordFailures=0   ids identical=yes (9,743 / 9,743; 12 organizations, 1,528 cases projected)
             run 2: records=7413   differences=0   recordFailures=0   ids identical=yes (9,743 / 9,743)
Deviations:  None. Record count equals the 2026-10-01 host replay (7,413).
```

### C-07 — L1 replay: capture with `main`, compare with the baseline

|               |                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Related       | D24 for every shared change since `PROD_SHA` (N3–N6 re-confirmed; N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15, N10.3)             |
| Source        | `docs/n2-replay-runbook.md` §3; `replay-compare.ts` (exit 1 on any unapproved class-A difference)                            |
| Why           | No D24 replay covers the N9/N10 code (roadmap N9.8a, N9.9, N9.13: "Not run: the D24 replay")                                 |
| Environment   | E4                                                                                                                           |
| Prerequisites | C-06                                                                                                                         |
| State         | Read-only on `sla_restore_drill`; writes the capture file                                                                    |
| Depends on    | C-06                                                                                                                         |
| Closes        | The D24 replay requirement of N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15 for existing providers (N9.14-F1 item (1), replay half) |

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <DUMP_TS> --out ~/elapsed-validation/replay/after.jsonl
pnpm --filter @sla/commitments replay:compare -- ~/elapsed-validation/replay/baseline.jsonl ~/elapsed-validation/replay/after.jsonl; echo "compare exit=$?"
```

**Pass:** `compare exit=0`; the report shows **0 differences** (class A unapproved 0, class B 0) over the record count; C-class drift identical to C-04's.
**On failure:** exit 1 lists the differences: stop, keep the files, classify under D24. Do not deploy.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, before=7cb2b9b, after=8dc2fe8, as-of 2026-10-01T10:40:33Z
Evidence:    records=5440 compared   differences=0   class A unapproved=0   class B=0   drift before/after=0 status, 9 breachedAt of 3923 / identical   compare exit=0
Deviations:  The capture and compare were run twice with identical output (the second run overwrote after.jsonl); no effect on the result.
```

### C-08 — Post-migration data assertions on the restore

|               |                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N10.1 seed and fold, D33 "deploy changes no behavior", N9.8 (`slaSupport` null for existing providers), D32 (`lastDataChangedAt` no backfill), N5.6/N6.3 defaults |
| Source        | Migration `20261009120000_n10_integration_availability`; D31/D32/D33; `schema.prisma` `WorkerSettings` defaults                                                   |
| Why           | Proves the release leaves existing tenants' behavior and switches as documented, and exposes the defaults that do change behavior                                 |
| Environment   | E4                                                                                                                                                                |
| Prerequisites | C-05                                                                                                                                                              |
| State         | READ-ONLY                                                                                                                                                         |
| Depends on    | C-05 (can run before or after C-06/C-07)                                                                                                                          |
| Closes        | N10.1 fold on production data; input to C-11's customer-impact list                                                                                               |

```bash
lsql sla_restore_drill <<'SQL'
select provider, enabled, "releaseStage", "betaAccess", version from integration_availability order by provider;
select (select count(*) from organizations where "customProviderEnabled") as flagged_orgs,
       (select count(*) from integration_beta_allowlist where provider = 'custom') as custom_allowlist;
select count(*) filter (where "slaSupport" is not null) as sla_support_set, count(*) filter (where "lastDataChangedAt" is not null) as data_changed_set,
       count(*) filter (where provider = 'custom') as custom_integrations from integrations;
select (select count(*) from integration_sync_runs) as sync_runs, (select count(*) from guard_overrides) as overrides;
select "monthlyReportEnabled", "entitlementsEnforced", "freshnessGraceFactor", "activePollIntervalMs", "reconciliationIntervalMs" from worker_settings;
select count(*) as orgs_with_trial_end from organizations where "trialEndsAt" is not null;
SQL
```

**Pass:** 6 availability rows exactly as in B-03; `custom_allowlist = flagged_orgs` (expected 0 and 0); `sla_support_set = 0`, `data_changed_set = 0`, `custom_integrations = 0`; 0 sync runs and overrides; `entitlementsEnforced = f`; `orgs_with_trial_end` recorded.
**Record for C-11:** `monthlyReportEnabled` (the column defaults to **true**: after the release the worker sends each organization a monthly report by email and Slack, N5.6) and `freshnessGraceFactor` (stale-source labels and held breach alerts, D13).

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, migrated 2026-10-01 restore
Evidence:    availability rows=6: zendesk/jira/linear stable+allowlist, intercom/github beta+all_organizations, custom beta+allowlist; all enabled=t, version 0 (as B-03)   flagged/allowlist=0/0   slaSupport/dataChanged/custom=0/0/0   runs/overrides=0/0
             monthlyReportEnabled=t   entitlementsEnforced=f   grace=3   intervals=active 5000 ms, reconciliation 3600000 ms   orgs with trial end=0
Deviations:  For C-11/OD-13: monthlyReportEnabled defaults to true (production already carries this column since 2026-10-09, so the setting is live there; see C-12).
```

### C-09 — N2.10 contract migration on the restore, through `prisma migrate deploy`, and rollback

|               |                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N2.10, N2.11                                                                                                                                                                                         |
| Source        | Roadmap N2.10 (preconditions; "Re-verified 2026-10-05"); contract `README.md` ("move this directory into `prisma/migrations/`, apply `schema.patch` …")                                              |
| Why           | Six migrations landed since the last re-verification; the migration's timestamp (`20261001110000`) is older than migrations already applied, so Prisma's acceptance of it is proven only by doing it |
| Environment   | E4                                                                                                                                                                                                   |
| Prerequisites | C-07 PASS (run after the replay; it alters the restore)                                                                                                                                              |
| State         | Alters, then restores, `sla_restore_drill`; creates a throwaway worktree                                                                                                                             |
| Depends on    | C-07                                                                                                                                                                                                 |
| Closes        | Re-verification of N2.10 on current `main` (release still needs C-16)                                                                                                                                |

```bash
C=packages/db/prisma/contract/20261001110000_contract_customer_identity_and_case_source
pre() { lsql sla_restore_drill <<'SQL'
select count(*) as cases_without_source from cases where "sourceIntegrationId" is null;
select (select count(*) from customer_identities) as identities,
       (select count("zendeskOrgId") + count("intercomCompanyId") + count("intercomContactId") from customers) as legacy_values;
select count(*) as cross_source_dups from (select "organizationId", "externalId" from cases group by 1, 2 having count(distinct "sourceIntegrationId") > 1) d;
select md5(string_agg(id || ':' || coalesce("zendeskOrgId", '') || ':' || coalesce("intercomCompanyId", '') || ':' || coalesce("intercomContactId", ''), '|' order by id)) as legacy_md5 from customers;
SQL
}
pre | tee ~/elapsed-validation/replay/n210-pre.txt
git worktree add ~/elapsed-validation/n210 "$MAIN_SHA" && cd ~/elapsed-validation/n210
git mv $C packages/db/prisma/migrations/20261001110000_contract_customer_identity_and_case_source && git apply packages/db/prisma/migrations/20261001110000_contract_customer_identity_and_case_source/schema.patch
pnpm install --frozen-lockfile && DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db generate && pnpm type-check; echo "type-check exit=$?"
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate deploy
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "contracted diff exit=$?"
# rollback, exactly as done on sla_test before (roadmap N2.10)
lsql sla_restore_drill < packages/db/prisma/migrations/20261001110000_contract_customer_identity_and_case_source/rollback.sql
lsql sla_restore_drill <<'SQL'
delete from _prisma_migrations where migration_name = '20261001110000_contract_customer_identity_and_case_source';
SQL
cd - && git worktree remove --force ~/elapsed-validation/n210
cd ~/elapsed-validation/main && DATABASE_URL="$DRILL_URL" pnpm --filter @sla/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; echo "after rollback diff exit=$?"
pre | tee ~/elapsed-validation/replay/n210-post.txt; diff ~/elapsed-validation/replay/n210-pre.txt ~/elapsed-validation/replay/n210-post.txt
```

**Pass:** preconditions `cases_without_source = 0`, `identities = legacy_values`, `cross_source_dups = 0`; `type-check exit=0` on the contracted schema; `migrate deploy` applies the contract migration (out of order) without error; `contracted diff exit=0`; after rollback `diff exit=0` against `main`'s schema and the pre/post files are identical (same `legacy_md5`).
**On failure:** N2.10 is not releasable; record which step failed. This does not block C-11 (N2.10 is a separate release).

```text
RESULT
Status:      [ ] PASS   [x] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, main=8dc2fe8 in a throwaway worktree, on the migrated 2026-10-01 restore
Evidence:    preconditions= cases_without_source=0, identities=124 = legacy_values=124, cross_source_dups=0, legacy_md5=7faeee41f519cf754f879880c750b6a5
             type-check= exit 1 on the contracted schema: apps/web/test/integration-disconnect-visibility.test.ts(333,67) error TS2322, Type 'null' is not assignable to type 'string | StringFieldUpdateOperationsInput' (the test "keeps a case with no recorded source integration visible" sets `sourceIntegrationId: null`)
             deploy applied out-of-order? [x] yes, "69 migrations found", applied 20261001110000_contract_customer_identity_and_case_source without error
             contracted diff=0 ("No difference detected")   rollback diff=0   md5 identical? [x] yes (pre and post files identical)
Deviations:  FAIL on the type-check criterion only. Cause: that test was added by commit 014ea51 (soft disconnect), after the 2026-10-05 re-verification, and assumes a nullable `Case.sourceIntegrationId`. `pnpm -r` stopped at apps/web, so other errors in packages after it were not listed. The suite would also fail at runtime on the contracted schema (the update sets NULL on a NOT NULL column). Does not block C-11 (N2.10 is a separate release); C-16 needs the test fixed on `testing` first (open item for E-03 and N2.10).
```

### C-10 — H-13 `breachedAt` backfill rehearsal on the restore

|               |                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | H-13; N1.2 class-C drift                                                                                                                                    |
| Source        | Roadmap H-13 ("To close (host)"); `packages/commitments/src/scripts/backfill-breached-at.ts`                                                                |
| Why           | Gives the exact expected production result for C-13 on today's data. **The script has no scratch-database guard**: `DATABASE_URL` must point at the restore |
| Environment   | E4                                                                                                                                                          |
| Prerequisites | C-09 done (or C-07 if you skip C-09)                                                                                                                        |
| State         | Writes `evaluations."breachedAt"` in `sla_restore_drill`                                                                                                    |
| Depends on    | C-07                                                                                                                                                        |
| Closes        | Rehearsal for H-13                                                                                                                                          |

```bash
cd ~/elapsed-validation/main
case "$DRILL_URL" in *localhost:5432/sla_restore_drill*) echo "target ok";; *) echo "WRONG TARGET, stop";; esac
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments backfill:breached-at
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments backfill:breached-at      # second run: 0 rows
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <DUMP_TS> --out ~/elapsed-validation/replay/after-h13.jsonl
pnpm --filter @sla/commitments replay:compare -- ~/elapsed-validation/replay/after.jsonl ~/elapsed-validation/replay/after-h13.jsonl; echo "compare exit=$?"
```

**Pass:** first run "Backfilled breachedAt for **9** Evaluation row(s)" (or the C-04 drift count) and 1 skipped commitment (`8000cdcb…`, recomputed status "met", by design); second run 0 rows; the new capture's drift line reads **0 status, 0 breachedAt**; compare exit 0 with 0 differences.
**On failure:** a different row count is not an error by itself: record it; C-13 then expects that number.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, main=8dc2fe8, on the migrated 2026-10-01 restore
Evidence:    run 1 rows=9 (10 commitments considered)   skipped=1 (8000cdcb..., recomputed status "met")   run 2 rows=0   drift after=0 status, 0 breachedAt of 3923   compare exit=0 (5,440 records, 0 differences, class A 0, class B 0)
Deviations:  None. Production's own data already shows 0/0 drift (C-05b), so the host repair C-13 is expected to change 0 rows.
```

### CHECKPOINT C1

Continue to the release only if: **C-01, C-03, C-04, C-05, C-06, C-07, C-08 PASS** and CHECKPOINT B's release prerequisites are met. A difference in C-06 or C-07 is a stop condition under D24 regardless of anything else.

```text
CHECKPOINT C1:  [ ] passed — release may be scheduled   [ ] stopped — reason:
```

### C-11 — GATED: release `main` (N2–N10) to production

|               |                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | Status Board "Up next (1)"; N2–N6 "built, not deployed"; N9 (Custom REST stays blocked by the rollout block); N10; DC-01                                                                                |
| Source        | `h-phase-close-out.md` Release row; `docs/deployment.md` "Updating"; `docs/production-backup-runbook.md` "two traps"                                                                                    |
| Why           | Most open items close only on the deployed code                                                                                                                                                         |
| Environment   | E6 · **MODIFIES PRODUCTION** (builds images, runs the 13 migrations, restarts web and worker)                                                                                                           |
| Prerequisites | CHECKPOINT C1; **OD-05** (your go-ahead); customer notices decided: D13 stale-source alert behavior, the monthly report default (OD-13, C-08), the new "Paused by Elapsed" states; a maintenance window |
| State         | MODIFIES PRODUCTION                                                                                                                                                                                     |
| Depends on    | CHECKPOINT C1                                                                                                                                                                                           |
| Closes        | "Deployed" state of N2–N10 (recorded by C-12)                                                                                                                                                           |

```bash
# on the host, immediately before deploying: a fresh pre-release backup (C-01's command with the label pre-release)
STAMP=$(date -u +%Y%m%dT%H%M%SZ) && umask 077 && dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner' sh "$APP_DB" < /dev/null > "backups/pre-release-elapsed_db-$STAMP.dump" && ls -lh "backups/pre-release-elapsed_db-$STAMP.dump"
git status --short                 # must be empty (restore the drill log first if C-02 left it modified)
git fetch origin main && git merge --ff-only origin/main && git rev-parse HEAD     # must equal MAIN_SHA
# Optional, only if you decided (OD-13) to hold monthly reports: bring up migrate and web first, keep the worker stopped,
# switch the kill switch off, then start the worker:
#   dc up -d --build migrate web && dc stop worker
#   dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$1" -c "update worker_settings set \"monthlyReportEnabled\" = false"' sh "$APP_DB"
dc up -d --build
dc ps -a --format 'table {{.Service}}\t{{.Status}}'
dc logs --no-color migrate | tail -20
```

**Pass:** `migrate` exited 0 and its log lists exactly C-05's migrations; `web`, `worker`, `postgres`, `nginx` running/healthy; `HEAD = MAIN_SHA`.
**On failure (migrate fails):** web and worker do not start (compose dependency). Read the error. To roll back: `docs/production-backup-runbook.md` §5 with `<DUMP>` = the pre-release dump **and** check out `PROD_SHA` before starting web and worker again, so `migrate` does not re-apply.

```text
RESULT
Status:      [x] DONE (before this audit; not run by this plan)   [ ] FAILED   [ ] NOT DONE (gate)
Run by/date: Release applied by the owner on 2026-10-09 (migrations finished 2026-10-09 15:23-23:56 UTC); recorded here 2026-10-10 from A-03 and A-04
Where:       host
Evidence:    pre-release dump= none found in backups/ after 2026-10-02 (pre-n3-elapsed_db-20261002T033846Z.dump is the newest before the release; A-07)   HEAD=8dc2fe8 (code of 0e48d28 + docs)
             migrate exit/log= 68 migrations applied, 0 failed, newest 20261009120000_n10_integration_availability   services= postgres, web, worker x3, nginx healthy 2026-10-10 (A-03, A-05)
             monthly reports held? [ ] unknown: worker_settings.monthlyReportEnabled on production is read in C-12 below
Deviations:  OD-05 (go-ahead) was effectively given by deploying; the C-05 to C-08 evidence was produced after the release (rework note), not before it.
```

### CHECKPOINT C2

```text
CHECKPOINT C2 (after C-11 and C-12):  [ ] production healthy on MAIN_SHA — continue   [ ] rolled back — reason:
```

### C-12 — Post-release verification (read-only)

|               |                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related       | Status Board (deployed commit), N2–N10 deployment, N10 "customers see Unavailable / Coming soon / Paused by Elapsed, never a false Disconnected" |
| Source        | `h-phase-close-out.md` Release row ("record the deployed commit in the roadmap Status Board"); `docs/integration-availability.md`                |
| Why           | Confirms the release and produces the record the roadmap asks for                                                                                |
| Environment   | E6 · PRODUCTION (read-only)                                                                                                                      |
| Prerequisites | C-11                                                                                                                                             |
| State         | READ-ONLY                                                                                                                                        |
| Depends on    | C-11                                                                                                                                             |
| Closes        | "Not deployed" notes on N2–N10 (E-03 records the commit)                                                                                         |

```bash
ro_sql <<'SQL'
select count(*) as applied from _prisma_migrations where finished_at is not null and rolled_back_at is null;
select migration_name from _prisma_migrations order by started_at desc limit 1;
select provider, enabled, "releaseStage", "betaAccess" from integration_availability order by provider;
select provider, status, count(*) from integrations group by 1, 2 order by 1, 2;
SQL
curl -sS "<NEXTAUTH_URL>/api/health"; echo
for c in $(dc ps -q worker); do docker exec "$c" wget -qO- http://localhost:8081/health | head -c 600; echo; done
dc logs --since 30m --no-color worker | grep -cE '"(work_failed|work_record_failed|uncaught_exception|unhandled_rejection)"'
dc logs --since 30m --no-color worker | grep -c '"work_finished"'
```

In the browser as an operator: `/admin`, `/admin/monitoring`, `/admin/integrations`, `/admin/tenants` load; as a customer owner: `/settings/integrations` shows every connected integration in its previous state (none "Paused by Elapsed", none "Disconnected" that was connected before).
**Pass:** 68 applied migrations, newest `20261009120000_n10_integration_availability`; availability rows as in B-03; integration status counts equal A-09's (no status changed by the release); health `ok`/`running`; `work_finished` > 0 and the failure count not above A-05's baseline rate.
**On failure:** a status change or a burst of `work_failed` after the release is an incident: decide on rollback (C-11 _On failure_).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED   (host part passes; status stays open until the browser checks are recorded)
Run by/date: Yasser Alnajjar, 2026-10-10 ~07:58 UTC
Where:       host, HEAD=8dc2fe8
Evidence:    applied=68   newest=20261009120000_n10_integration_availability   availability=6 rows as B-03 (zendesk/jira/linear stable+allowlist; intercom/github beta+all_organizations; custom beta+allowlist; all enabled)   status counts same as A-09? [x] yes (jira connected 1, intercom connected 1)
             health=web ok (database ok); worker x3 running, 0 failedRuns, 0 expired leases, 0 failing, 0 overdue   failures/finished (30 min)=0 / 60   UI checks? [ ] not yet
             worker_settings: monthlyReportEnabled=t, entitlementsEnforced=f, freshnessGraceFactor=3; organizations with trialEndsAt = 1; no "monthly" line in the last 24 h of worker logs
Deviations:  monthlyReportEnabled is true in production (OD-13): no monthly-report log in 24 h, so it is not known whether a report was sent; the schedule or the per-organization state has to be read from the code or a later log. One organization has a trial end date (C-08 on the old data had 0): the trial lifecycle (N6) is active for it, with entitlementsEnforced=f.
```

### C-13 — GATED: H-13 production backfill

|               |                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Related       | H-13                                                                                                               |
| Source        | Roadmap H-13 "To close (host)"; `h-phase-close-out.md` H-13 row                                                    |
| Why           | The 9 `breachedAt` NULL rows make the dashboard's breaches-over-time fall back to `dueAt` for one organization     |
| Environment   | E6 · **MODIFIES PRODUCTION DATA** (`UPDATE evaluations set "breachedAt"` for the rows C-10 identified; idempotent) |
| Prerequisites | C-10 PASS (expected count known); C-12 PASS; OD-05; a fresh backup taken right before                              |
| State         | MODIFIES PRODUCTION                                                                                                |
| Depends on    | C-10, C-12                                                                                                         |
| Closes        | H-13 (with C-14)                                                                                                   |

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ) && umask 077 && dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner' sh "$APP_DB" < /dev/null > "backups/pre-h13-elapsed_db-$STAMP.dump" && ls -lh "backups/pre-h13-elapsed_db-$STAMP.dump"
W=$(dc ps -q worker | head -1)
docker exec "$W" sh -c 'case "$DATABASE_URL" in */'"$APP_DB"'*) echo "worker targets '"$APP_DB"'";; *) echo "UNEXPECTED DATABASE, stop";; esac'
docker exec -w /repo/packages/commitments "$W" ./node_modules/.bin/tsx src/scripts/backfill-breached-at.ts
docker exec -w /repo/packages/commitments "$W" ./node_modules/.bin/tsx src/scripts/backfill-breached-at.ts     # second run: 0 rows
```

**Pass:** first run updates exactly C-10's row count with the same single skipped commitment; second run 0 rows.
**On failure:** a different count: stop and compare with C-10 (data may have changed since the dump); the backup above is the undo.

```text
RESULT
Status:      [ ] DONE   [ ] FAILED   [x] NOT DONE (gate) — not needed on current evidence
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       host (not run); evidence from the 2026-10-10 production dump restored locally (C-05b)
Evidence:    backup=n/a   run 1 rows=n/a   skipped=n/a   run 2 rows=n/a
             C-05b: a capture of the 2026-10-10 production dump reports drift 0 status, 0 breachedAt of 58 commitments, so the H-13 repair has nothing left to update in production (the 9 rows existed only in the 2026-10-01 data; C-10)
Deviations:  H-13 appears already repaired in production, or the 9 affected evaluations are gone with the removed fixture organizations (A-09). Which of the two is not established by this plan. Do not run this write on production unless a new capture shows drift above 0.
```

### C-14 — Post-release drift capture (the "re-run the replay" step, DC-13)

|               |                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Related       | N2.11 ("After deploying, re-run the replay"); H-13 ("Then a replay capture should report drift 0 / 0"); D24 |
| Source        | `h-phase-close-out.md` Release and H-13 rows                                                                |
| Why           | Shows the deployed code recomputes every stored status and breach instant identically on production data    |
| Environment   | E4 (a restore of a post-release production backup on your machine)                                          |
| Prerequisites | C-12 (and C-13 if done); OD-11 accepts this method                                                          |
| State         | Read-only on production (`pg_dump`); writes a local restore                                                 |
| Depends on    | C-12                                                                                                        |
| Closes        | N2.11's post-release replay wording; H-13's drift criterion                                                 |

Take a backup as in C-01 (label `post-release`), copy it off the host, restore it as in C-03, then:

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <POST_DUMP_TS> --out ~/elapsed-validation/replay/post-release.jsonl
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2-post
```

**Pass:** drift line **0 status, 0 breachedAt** (or 0 status and C-04's `breachedAt` count if C-13 was not run); L2 0 differences, 0 record failures. When done: `ldc exec -T postgres dropdb -U user sla_restore_drill` and delete the local dumps you no longer need.

```text
RESULT
Status:      [x] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       local, the 2026-10-10 production dump (taken after the release; it is the post-release dump)
Evidence:    POST_DUMP_TS=2026-10-10T07:41:45Z   drift=0 status, 0 breachedAt of 58 commitments (C-05b)   L2 differences/failures=0/0 (1 organization, 24 cases projected, 127 records, 153/153 NormalizedEvent ids identical)
Deviations:  C-01's dump serves as the post-release dump, so no further backup is taken. OD-11 (accept this method) is still open.
```

### C-15 — H-10 production security verification (corrected for the host's database)

|               |                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | H-10; Launch Gate security items; `data-retention-and-on-call.md` ("whether `pnpm db:encrypt-tokens` has been run on production is not verified"); DC-06 |
| Source        | `scripts/prod/h10-verify.sh`; `h-phase-close-out.md` "H-10 — production security verification"                                                           |
| Why           | The script's token check (3) queries `$POSTGRES_DB`, the empty database on this host, so it can pass vacuously; checks 1, 2 and 4 are valid              |
| Environment   | E6 · PRODUCTION (read-only; the script compares hashes and prints no value)                                                                              |
| Prerequisites | A-03; a non-shallow clone on the host (`git rev-parse --is-shallow-repository` prints `false`) for check 1; `shasum` installed                           |
| State         | READ-ONLY                                                                                                                                                |
| Depends on    | A-03 (run after C-12 so it checks the deployed stack)                                                                                                    |
| Closes        | H-10's script part and the encryption "not verified" line; the third-party rotation is D-05                                                              |

```bash
git rev-parse --is-shallow-repository; command -v shasum
scripts/prod/h10-verify.sh "$ENV_FILE" 2>&1 | tee ~/validation/h10.txt
ro_sql <<'SQL'
select count(*) as plaintext_access_tokens from integrations where credentials ->> 'accessToken' is not null and credentials ->> 'accessToken' not like 'enc:v1:%';
select count(*) as plaintext_refresh_tokens from integrations where credentials ->> 'refreshToken' is not null and credentials ->> 'refreshToken' not like 'enc:v1:%';
select count(*) as slack_plaintext from slack_integrations where "accessToken" not like 'enc:v1:%';
SQL
dc exec -T web printenv NODE_ENV
# Cross-name check (DC-20): prints only SAME or DIFFERENT, never a value
strip() { sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']\$//"; }
cur=$(grep -E '^DEPLOYMENT_SMTP_PASSWORD=' "$ENV_FILE" | tail -1 | strip); res=DIFFERENT
for c in $(git log --all --format=%h -- .env.prod); do
  old=$(git show "$c:.env.prod" 2>/dev/null | grep -E '^OPS_ALERT_SMTP_PASSWORD=' | tail -1 | strip)
  [ -n "$old" ] && [ -n "$cur" ] && [ "$(printf %s "$old" | shasum -a 256)" = "$(printf %s "$cur" | shasum -a 256)" ] && res=SAME
done; echo "DEPLOYMENT_SMTP_PASSWORD vs leaked OPS_ALERT_SMTP_PASSWORD: $res"; unset cur old
```

**Pass:** the cross-name check prints `DIFFERENT` (a `SAME` is a FAIL: the leaked password is still in use, D-05); no `FAIL` line in sections 1, 2 and 4; ignore section 3's database answer and use the `ro_sql` counts instead, which must all be **0**; `NODE_ENV=production`; every `MANUAL` line answered in Evidence (the seed-data question is answered by A-09 and OD-07).
**On failure:** a `FAIL` in section 1 means a leaked value is still in use: rotate it (`docs/deployment.md` "Rotating secrets"); plaintext tokens: `pnpm db:encrypt-tokens` is the documented repair (a production write: your decision).

```text
RESULT
Status:      [ ] PASS   [x] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       host, HEAD=8dc2fe8
Evidence:    FAIL lines=0 from h10-verify.sh, but the cross-name check below FAILS   PASS lines=13 (check 1: DATABASE_URL, INTEGRATION_CONFIG_ENCRYPTION_KEY, NEXTAUTH_SECRET, POSTGRES_PASSWORD, SENTRY_DSN, SMTP_ENCRYPTION_KEY differ from every leaked value; check 2: 4 secrets set and distinct; check 4: only nginx publishes host ports, web NODE_ENV=production, no dev ports)
             plaintext access/refresh/slack=0/0/0 (database query by hand; check 3 of the script said "could not query the database", as predicted)   NODE_ENV=production (web)
             cross-name check: DEPLOYMENT_SMTP_PASSWORD vs leaked OPS_ALERT_SMTP_PASSWORD = SAME
             MANUAL answers: OPS_ALERT_SMTP_PASSWORD is empty now but its old value is in use as DEPLOYMENT_SMTP_PASSWORD, so it was not retired at its provider; SENTRY_DSN differs from the leaked value (BL-07/BL-08 still ask for provider-side revocation); third-party rotation cannot be proven from the host (D-05); the "10 real tenants" line is answered by A-09 (1 non-fixture organization, 0 fixtures; OD-07)
Deviations:  The script's own "no FAIL" is not enough: the leaked ops SMTP password is still live as DEPLOYMENT_SMTP_PASSWORD (DC-20). Owner action: replace that password at the SMTP provider and in `.env`, then re-run this check (expect DIFFERENT). git history is complete on the host (`--is-shallow-repository` = false).
```

### C-16 — GATED: N2.10 contract release

|               |                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related       | N2.10, N2.11 (the phase closes with it)                                                                                                                      |
| Source        | Roadmap N2.10 ("ship it as its own release, after a fresh backup"); contract `README.md`                                                                     |
| Why           | Drops the legacy identity columns and the source-less Case key                                                                                               |
| Environment   | E6 · **MODIFIES PRODUCTION** (and a code change through a reviewed PR)                                                                                       |
| Prerequisites | C-09 PASS; C-12 PASS and at least one production release on the N1/N2 dual-write code (C-11 is that release); C-14 PASS; OD-05 for this release specifically |
| State         | MODIFIES PRODUCTION                                                                                                                                          |
| Depends on    | C-09, C-14                                                                                                                                                   |
| Closes        | N2.10, then N2.11                                                                                                                                            |

On your machine, on a new branch (the same moves as C-09, committed): `git mv` the contract directory into `packages/db/prisma/migrations/`, `git apply` its `schema.patch`, `pnpm --filter @sla/db generate`, `pnpm type-check`, commit, open a PR to `main`, merge after review. On the host: a fresh backup (C-01 command, label `pre-n210`), then C-11's update commands with the new `MAIN_SHA`; then C-12; then C-14 on a new backup.
**Pass:** `migrate` applies `20261001110000_contract_customer_identity_and_case_source`; C-12 and C-14 pass on the contracted schema.
**On failure:** `rollback.sql` (by hand) and the `_prisma_migrations` row removal exactly as rehearsed in C-09, or restore the `pre-n210` dump.

```text
RESULT
Status:      [ ] DONE   [ ] FAILED   [ ] NOT DONE (gate)
Run by/date:
Where:
Evidence:    PR=   HEAD=   migrate log=   C-12 rerun=   C-14 rerun=
Deviations:
```

### C-17 — N4.7 plan-record counts after your data entry

|               |                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N4.7; N4 "Phase is done when: the 10 tenants' records are filled in"; Validation Metrics "Commercial"                                                     |
| Source        | Roadmap N4.7; `scripts/prod/n47-plan-records.sql` (its header uses `$POSTGRES_DB`: use `ro_sql`, DC-06)                                                   |
| Why           | The tooling exists; the data is not entered                                                                                                               |
| Environment   | E6 · PRODUCTION: your data entry in `/admin/tenants/[organizationId]` **modifies production data through the audited UI**; this check itself is READ-ONLY |
| Prerequisites | C-12; OD-07 (which organizations are the real customers)                                                                                                  |
| State         | READ-ONLY                                                                                                                                                 |
| Depends on    | C-12                                                                                                                                                      |
| Closes        | N4.7 and N4 (counts pasted to the Status Board in E-03)                                                                                                   |

```bash
ro_sql < scripts/prod/n47-plan-records.sql
```

**Pass:** in table 2, `plan_not_recorded = 0`; `trial_without_end_date` and `paying_without_billing_reference` equal what you intended; table 1 pasted (counts only).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED   [ ] SKIPPED   (owner data entry in /admin/tenants not done)
Run by/date: Yasser Alnajjar, 2026-10-10
Where:       host
Evidence:    table 1= non-fixture organizations: plan "(not recorded)", status trial, 1 tenant
             table 2= tenants=1   plan_not_recorded=1   trial_without_end_date=0   trial_already_ended=0   paying_without_billing_reference=0
Deviations:  Blocked on the plan-record entry for the one real organization (OD-07: only 1 organization exists, not 10).
```

### C-18 — Production measurements for N3.7, N8 triggers and the Validation Metrics (read-only, weekly)

|               |                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N3.7 (circuit breaker "only if production measurements justify it", D22); N8-S1–S4 triggers; roadmap "Validation Metrics" (reliability rows, weekly active orgs) |
| Source        | `h-phase-close-out.md` N3.6/N3.7 row ("read `/admin/monitoring` … for a few weeks, then record 'not needed, measured at X ms'"); plan 08 trigger table           |
| Why           | N3.7 and the N8 items are decided only by production measurements; none is recorded                                                                              |
| Environment   | E6 · PRODUCTION (read-only)                                                                                                                                      |
| Prerequisites | C-12 (the columns exist only after the release)                                                                                                                  |
| State         | READ-ONLY                                                                                                                                                        |
| Depends on    | C-12; repeat weekly for at least 3 weeks                                                                                                                         |
| Closes        | N3.7 decision input; N8 trigger status; Validation Metrics baseline                                                                                              |

```bash
ro_sql <<'SQL'
select provider, count(*) as connected, max("consecutiveFailures") as max_streak,
       count(*) filter (where "failingSince" is not null) as failing_now,
       percentile_cont(0.5) within group (order by "lastSyncDurationMs") as p50_ms,
       percentile_cont(0.95) within group (order by "lastSyncDurationMs") as p95_ms, max("lastSyncDurationMs") as max_ms
from integrations where status = 'connected' group by provider order by provider;
select count(*) filter (where "lastSuccessfulSyncAt" >= now() - 2 * "activePollIntervalMs" * interval '1 millisecond') as healthy_now,
       count(*) as connected from integrations, worker_settings where status = 'connected';
select "activePollIntervalMs", "lastActivePollDurationMs", "reconciliationIntervalMs", "lastReconciliationDurationMs" from worker_settings;
select count(*) filter (where "activeNextDueAt" < now() - interval '10 minutes') as overdue_active,
       count(*) filter (where "reconciliationNextDueAt" < now() - interval '60 minutes') as overdue_recon, count(*) as orgs from organization_work_states;
select (select count(*) from notification_failures where "lastFailedAt" > now() - interval '30 days') as failures_30d,
       (select count(*) from notifications where "sentAt" > now() - interval '30 days') as sent_30d;
select count(distinct "organizationId") as weekly_active_orgs from users where "lastSeenAt" > now() - interval '7 days';
SQL
```

**Pass (as a measurement):** the numbers are recorded each week. Trigger evaluation for you to record in E-03: N8-S1 if `lastActivePollDurationMs` > 50 % of `activePollIntervalMs`; N3.7 "not needed" if no provider shows recurring failure streaks or p95 durations near the 30 s per-attempt bound; Validation Metrics: integration-hours healthy ≥ 95 %, alert failure rate < 1 %.

```text
RESULT (one line per week)
Week 1 (2026-10-10):  per-provider p95/max/streaks= jira 496/496 ms, 0 streak; intercom 907/907 ms, 0 streak (1 connected each, 0 failing)   healthy=2/2   tick ratio=not computable (lastActivePollDurationMs and lastReconciliationDurationMs are empty in worker_settings; activePollIntervalMs=30000, reconciliationIntervalMs=1800000)   overdue=0 active / 0 reconciliation of 1 organization   alert failure rate=0 failures / 8 sent in 30 d   WAO=1
Week 2 (date):
Week 3 (date):
Conclusion for N3.7 / N8:
```

---

## 7. Phase D — External dependencies and missing infrastructure

Each item starts when its prerequisite exists; none blocks the release (C-11) except where stated. Where no command exists in the repository, none is invented: the prerequisite is listed instead.

### D-01 — N9.7-F1: plan 09 §6.10 benchmark gate that fixes the Custom REST live-case ceiling

|               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.7 exit criterion, N9.7-F1, N9.14-F1 (3), Q13, R4; OD-08                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Source        | Plan 09 §6.9, §6.10; roadmap N9.7-F1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Why           | No ceiling is validated; Beta enablement is blocked until a written report fixes `C`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Environment   | E4 · a host matching A-10, a fresh database whose name contains `bench`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Prerequisites | **BLOCKED.** (1) BL-01: a §6.10 harness does not exist (`packages/custom-ticket/bench/` is absent; `apps/worker/scripts/bench/run.ts` measures multi-worker scheduling with a fake Linear, and `pnpm db:seed:perf-baseline` inserts `NormalizedEvent` rows directly, which §6.10 forbids). It must drive synthetic custom-shaped data through the real `deriveBatch` and projector, on `testing`. (2) BL-02/A-10 host profile. (3) OD-08 method approval. (4) To apply a ceiling other than 5,000 in production, BL-10 (`CUSTOM_PROVIDER_LIVE_CASE_CEILING` is not passed by `docker-compose.yml`) |
| State         | Writes only the `*bench*` database                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Depends on    | A-10, OD-08                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Closes        | N9.7-F1; the ceiling `C`; N9.14-F1 item (3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Commands:** none exist yet. When the harness exists, it must report per tier (1,000 / 5,000 / 10,000 / 20,000 live cases) and per pass (full; incremental at 1 %, 5 %, 25 %; first activation dry-run; guard abort), ≥ 5 runs per cell, with `PERF_METRICS=1` scopes comparable to `docs/capacity-limits.md`.
**Pass (plan 09 §6.10):** per tier, p95 organization sweep ≤ **30 s** and p95 organization-lock hold ≤ **10 s** including custom normalization and projection; memory inside the worker limit with the margin stated; query count and lock time no worse than linear (slope reported); the guard-abort pass writes nothing. `C` = largest passing tier; if the incremental design is used, correctness criteria 1–7 of §6.10 also pass. A failing tier is never answered by raising a limit.

```text
RESULT
Status:      [x] PASS as a PROVISIONAL BETA SAFEGUARD ONLY (OD-08, 2026-10-10)   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED   (the benchmark was RUN; BL-01 and BL-02 are resolved; outcome below). NOT proof of production-host performance: the real-host rerun below is still required before C is raised, and the scenarios listed under Deviations (2) were not run and are not claimed as passed.
Owner decision 2026-10-10 (OD-08): method accepted for a provisional Beta safeguard; C = 1,000 live cases per integration. Semantics verified in code: `CUSTOM_PROVIDER_LIVE_CASE_CEILING` is read only by the worker's `normalizeCustom`, once per normalization pass and integration, `L + N > C` where `L` = live cases and `N` = distinct tickets in the stored set that are not live cases (this includes tickets already deleted, which keep counting: see D-08 follow-up 2, row 9). It is not a per-request fetch cap; the per-run fetch limits (50 pages, 5,000 tickets, 120 s) are separate and unchanged. A source whose import window holds more than 1,000 tickets stores the raw snapshots and then stops at `live_case_ceiling` (customer message: narrow the listing). Changes made: compiled default 5,000 -> 1,000 (`packages/custom-ticket/src/guards.ts`), worker Compose wiring with default 1000, `.env.example` (commit 8b123a5). All other code paths checked: no other reader of the variable; the web app, activation and preview do not evaluate the ceiling. Follow-ups (plan 09 §6.10 "Follow-up items"): real-host benchmark before any increase; projector write batching as a separate performance item with its own acceptance criteria.
Run by/date: Yasser Alnajjar (authorized the work); executed by Claude Code from the cloud session, 2026-10-10 11:50 to 13:00 UTC
Where:       harness `apps/worker/scripts/bench/custom-rest/` (commit dd5a2d9, `PERF_METRICS=1`), branch claude/sharp-euler-gm4not (includes origin/main 1b1e084). Database `sla_custom_bench` (a fresh scratch database migrated from the current schema, 68 migrations; name contains "bench").
             Host: cloud container, 4 vCPU Intel Xeon 2.1 GHz, 16 GB RAM, local PostgreSQL 16 on the same host. To approximate the production host (A-10: t3.medium, 2 vCPU Xeon 8259CL 2.5 GHz, 3.7 GiB, 3 worker replicas) the worker child processes AND every PostgreSQL process were pinned to 2 CPUs (`taskset -c 0,1`); memory was not limited. NOT production hardware: no burstable-CPU credit effects, a faster local disk, 4x the RAM, a different CPU generation. Each run is a fresh worker process (cold process, warm database cache).
Method:      Synthetic custom-shaped raw events (the form `buildTicketEvents` stores) are seeded for N tickets (1 snapshot, 5 comments, a status-history entry for one ticket in three; the mock helpdesk's ticket shape) with `polling paused`, so provider ingestion is excluded, as §6.10 defines the 30 s and 10 s figures. The REAL worker cycle then runs (`runCycle`: `normalizeCustom` with `deriveBatch` and the guards, the shared projector, commitments, next-reply cycles, evaluation, notifications) under the real organization lock. Nothing is inserted into NormalizedEvent directly. Per tier: 1 first full pass (everything new; repeatable only by reseeding), 5 steady full passes (reconciliation sweep), 5 poll passes, 3 lifecycle-guard abort passes. "Sweep" = wall time of the cycle for the organization (ingestion-independent because polling is paused); "lock" = `organization_lock_duration` holdMs.
Evidence:    all figures in ms unless stated; p95 of 5 runs (= nearest rank, i.e. the maximum of five); raw reports in `docs/validation/evidence/d-01-benchmark/` (5 JSON files)
             tier  | steady sweep p95 | steady lock p95 | poll lock p95 | queries (per case) | first-pass lock / peak RSS | steady peak RSS p95 | limits (30 s sweep, 10 s lock)
             1,000 | 5,160            | 4,968           | 4,851         | 3,118 (3.1)        | 12,193 / 509 MB            | 397 MB              | PASS
             1,500 | 8,111            | 7,897           | 7,835         | 4,622 (3.1)        | 21,933 / 533 MB            | 417 MB              | PASS (extra tier)
             2,000 | 10,759           | 10,500          | 11,952        | 6,122 (3.1)        | 24,673 / 636 MB            | 425 MB              | FAIL lock (extra tier)
             2,500 | 10,947           | 10,740          | 10,973        | 7,626 (3.1)        | 30,513 / 645 MB            | 453 MB              | FAIL lock (extra tier)
             5,000 | 20,796           | 20,546          | 21,826        | 15,134 (3.0)       | 59,555 / 905 MB            | 568 MB              | FAIL lock (sweep passes)
             10,000| 41,206           | 40,988          | 39,981        | 30,154 (3.0)       | 123,910 / 1,309 MB         | 748 MB              | FAIL sweep and lock
             20,000| 80,223           | 79,943          | 87,708        | 60,194 (3.0)       | 242,746 / 2,353 MB         | 800 MB              | FAIL sweep and lock
             (the 10,000 and 20,000 tiers ran with CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000, for measurement only; run 1 shows the same tiers under the default ceiling of 5,000 being refused by the ceiling guard in 1.4 to 3.1 s with no case written, i.e. the ceiling fails safely)
             Scaling (plan: "no worse than linear, slope reported"): lock hold grows about linearly, 3.9 ms per live case between 10,000 and 20,000 (log-log exponent 0.96 for lock and sweep, 1.00 for queries); queries are about 3.0 to 3.1 per case in every tier, including steady passes where nothing changed. The cost is the shared projector's per-case round trips (`packages/ingestion/src/projector.ts`: one upsert per case, one event reconcile per case, run sequentially inside the lock); `worker_normalize` is about 91 % of the lock hold at every tier.
             Guard-abort pass (35 % of tickets flipped, R > 0.25 x L): every tier aborts with `mass_lifecycle_change`, cheaply (0.9 s at 1,000; 8.3 s at 20,000) and the content fingerprint of cases, events and commitments is identical before and after (writes nothing: true at all four tiers).
             Worst-case volume cell (1,000 cases, 5 snapshots and 20 comments per ticket, 25,334 raw events): steady lock p95 6,898 (+39 % against the 1,000 tier), poll lock p95 8,069, first-pass lock 23,447, peak RSS 717 MB, abort writes nothing. Still inside the limits.
             Concurrency cell (1,000 cases plus a second organization of 500 processed in the same cycle): steady lock p95 5,756 (+16 %), inside the limits.
             C = 1,000 live cases is the largest tier of the plan's tier set (1,000 / 5,000 / 10,000 / 20,000) that passes both limits on this host. The finer tiers measured 1,500 as passing (7.9 s) and 2,000 as failing (10.5 s); the crossing is between 1,500 and 2,000 on this host. The provisional default of 5,000 (R4) FAILS the lock limit by 2x here and must not be treated as validated. Plan 09 §6.10: "a failing benchmark is never answered by raising a limit"; the ceiling is lowered or the design revised before Beta.
             Memory: at C = 1,000 the first activation pass peaks at 509 MB RSS (717 MB worst-case volume) and steady passes at 397 to 497 MB. The production host has 3.7 GiB for three worker replicas, web and PostgreSQL; the margin is thin if several replicas run a first pass together. At 5,000 the first pass is 905 MB; at 20,000 it is 2.35 GB (more than the whole production host could give one replica).
             Correctness and replay criteria of §6.10 (incremental design): NOT APPLICABLE. The incremental design is not implemented (`incrementalNormalization` is false), so no tier "passes only with the incremental design" and the incremental passes at 1 %, 5 % and 25 % were not run.
Deviations:  (1) Not production hardware (see Where); results on a t3.medium may be slower (burstable CPU) or faster (no co-located web and other replicas here). They should be repeated on the host or an equal instance before C is fixed. (2) Not run: first-activation dry-run pass; a 64 KB payload worst case (payloads here are small); cold database cache; repeated passes in one process for the leak check (each run is a fresh process, peak RSS and heap are reported per run); webhooks waiting on the lock (the second-organization cell stands in only for concurrent processing). (3) The first full pass has one run per tier (repeatable only by reseeding); steady, poll and abort passes have 5, 5 and 3. With five runs p95 is the maximum, so it is conservative. (4) First harness run: the 10,000 and 20,000 tiers were refused by the default ceiling (correct behavior) and were rerun with the ceiling raised; both runs are kept. (5) The 2,000 and 2,500 tiers show 10.5 and 10.7 s although 5,000 shows 20.5 s (4.1 to 5.2 ms per case): run-to-run variation of roughly 10 % on a shared host, not a trend.
(Superseded by the OD-08 decision above; kept as the original request.) Needs the owner (OD-08): (a) approve the method (tiers, repetitions, host, pinning) or ask for a rerun on the production host; (b) decide what to do about the result: set C = 1,000 (the tier set's answer; 1,500 if finer tiers are accepted) and keep the design; or reduce the cost per case first (batch the projector's per-case writes, which is shared code with every provider and falls under D24 replay) and rerun; or implement the incremental design and pass its criteria. Recommendation: set C = 1,000 for Beta (one or two pilots), because the measured cost per case is linear and 5,000 is 2x over the limit, and pursue the projector batching as a separate reviewed item before raising C. (c) BL-10: `docker-compose.yml` does not pass `CUSTOM_PROVIDER_LIVE_CASE_CEILING` to any container, so production would keep the unvalidated 5,000 whatever is decided; passing it is a one-line change to the worker (and web) `environment:` blocks that was NOT made here (production configuration; owner's call).
```

### D-02 — N3.6: production-scale two-hour outage drill

|               |                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N3.6, N3 "Phase is done when" (other tenants' tick time within ±10 %; no stale-source alert without D13 treatment), D13, D22                                                                                                                                                                                                                                                                      |
| Source        | Roadmap N3.6; plan 03; `h-phase-close-out.md` N3.6/N3.7 row ("Do not pause a real customer's polling to simulate an outage")                                                                                                                                                                                                                                                                      |
| Why           | Only unit/real-DB drills exist (`cycle.test.ts`, `stale-source-notifications.test.ts`)                                                                                                                                                                                                                                                                                                            |
| Environment   | E4 · staging host matching A-10, with a production-scale dataset whose provider calls are all faked                                                                                                                                                                                                                                                                                               |
| Prerequisites | **BLOCKED (BL-05).** No outage-injection harness: `apps/worker/scripts/bench/fake-linear-preload.mjs` supports latency only (`BENCH_PROVIDER_LATENCY_MS`), not a per-tenant hang or error for two hours. Needs: a staging host, a dataset (seeded, or a restore with the production encryption keys absent so no real provider can be called), and a per-tenant failure mode. Never on production |
| State         | Staging only                                                                                                                                                                                                                                                                                                                                                                                      |
| Depends on    | A-10                                                                                                                                                                                                                                                                                                                                                                                              |
| Closes        | N3.6, then N3's phase status (with N3.7 from C-18)                                                                                                                                                                                                                                                                                                                                                |

**Pass:** during a 2-hour outage of one tenant's provider, every other tenant's per-organization run duration stays within ±10 % of its pre-outage median; the outage tenant's at-risk alerts carry the stale marker and its breach alerts are held, then sent once after recovery.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-05)   [ ] SKIPPED
Run by/date:
Where:
Evidence:    other tenants' median before/during=        stale at-risk marked? [ ]  breach held then sent once? [ ]
Deviations:
```

### D-03 — N5.8 / H-9 / 6.8: live onboarding walkthroughs per provider pair

|               |                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related       | N5.8, H-9, historical 6.8; N5 "Phase is done when: all four pairs onboard in local dev, and Zendesk + Jira live"; Launch Gate product item 1           |
| Source        | `h-phase-close-out.md` "H-9 — live onboarding walkthrough" and Remaining owner actions (N5.8 / H-9 row)                                                |
| Why           | Only stubbed walkthroughs exist (N1.16); no real OAuth round trip                                                                                      |
| Environment   | E5 · your local stack plus real sandbox accounts (no production)                                                                                       |
| Prerequisites | **BLOCKED (BL-06):** Zendesk sandbox admin login and OAuth client (required); Intercom and Linear sandbox workspaces with OAuth apps; a Jira test site |
| State         | Local only; reads the sandbox accounts                                                                                                                 |
| Depends on    | B-02 (a building stack)                                                                                                                                |
| Closes        | N5.8, H-9, 6.8 (and N5's phase status)                                                                                                                 |

Follow the H-9 checklist exactly (fresh organization, new email, timer, no help) once per pair: Zendesk + Jira, Zendesk + Linear, Intercom + Jira, Intercom + Linear. Start the stack as that document says (`docker compose --env-file .env.docker up -d`, never plain `up`) or with B-08's terminals.
**Pass per pair:** reached the first monitored case unaided; record minutes from sign-up to first monitored case, every hesitation, every error, tickets and policies imported. Zendesk + Jira is mandatory for N5.8/H-9.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-06)   [ ] SKIPPED
Run by/date:
Evidence:    pair            | unaided | minutes | hesitations | errors | tickets/policies
             Zendesk+Jira    |         |         |             |        |
             Zendesk+Linear  |         |         |             |        |
             Intercom+Jira   |         |         |             |        |
             Intercom+Linear |         |         |             |        |
Deviations:
```

### D-04 — N1.13: capture an Intercom → Linear link shape

|               |                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Related       | N1.13 (`[~]`); Review Trigger "link coverage < 60 %"                                                                  |
| Source        | Roadmap N1.13 ("Not done, environment limit (1)"); `h-phase-close-out.md` N1.13 row                                   |
| Why           | Only the URL shape this repository builds is recognized; Intercom + Linear customers may see low link coverage        |
| Environment   | E5 · a real Intercom workspace linked to Linear                                                                       |
| Prerequisites | **BLOCKED (BL-06)**                                                                                                   |
| State         | Reads the sandbox                                                                                                     |
| Depends on    | –                                                                                                                     |
| Closes        | N1.13's capture half. Its L2 half ("Zendesk tenants' `certain` link counts and legs identical") is closed by **C-06** |

Link one Intercom conversation to a Linear issue with Intercom's Linear integration; in Linear, open the issue's attachments and copy the stored URL; redact the workspace and ids to placeholders, keeping the host and path shape.
**Pass:** the shape is recorded here. Adding it as a fixture in `recognizeIntercomConversationUrl`'s tests is implementation work that follows.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-06)   [ ] SKIPPED
Evidence:    URL shape (redacted)=
```

### D-05 — H-10: replace the leaked third-party credentials and record the rotation

|               |                                                                                                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | H-10; Launch Gate "Every leaked secret has been rotated"                                                                                                                                                                                                                                                                |
| Source        | `h-phase-close-out.md` "Findings from this pass" 1; `docs/deployment.md` "Rotating secrets" (rotation log; "The script can't rotate third-party credentials")                                                                                                                                                           |
| Why           | The leaked `.env.prod` held `OPS_ALERT_SMTP_PASSWORD` (+ user/host) and `SENTRY_DSN`; the 2026-09-19 rotation covered four other secrets only. Since D8's update the ops alert mail goes through `DEPLOYMENT_SMTP_*`, so a leaked ops SMTP password may now live on under that name (C-15's extra comparison checks it) |
| Environment   | E6 · **MODIFIES PRODUCTION** configuration (restart) + provider consoles                                                                                                                                                                                                                                                |
| Prerequisites | **BLOCKED (BL-08)** on your provider accounts; a backup is not needed (no data change)                                                                                                                                                                                                                                  |
| State         | MODIFIES PRODUCTION                                                                                                                                                                                                                                                                                                     |
| Depends on    | C-15                                                                                                                                                                                                                                                                                                                    |
| Closes        | H-10 (with C-15 PASS, OD-07, OD-12)                                                                                                                                                                                                                                                                                     |

Revoke and replace at the providers (SMTP account password or app password; Sentry DSN key), edit the env file on the host yourself, then `dc up -d web worker`, re-run **C-15**, and add a row to the rotation log table in `docs/deployment.md` (date, reason, scope, method; no values).
**Pass:** C-15 re-run shows no `FAIL`, the extra comparison prints `DIFFERENT` (or the old key is unset), A-05 healthy after the restart, rotation-log row committed.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-08)   [ ] SKIPPED
Evidence:    revoked at providers (date)=   C-15 re-run=   rotation log row committed? [ ]
```

### D-06 — H-6: Sentry source maps on the host (gated rebuild)

|               |                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Related       | H-6 (was 7.6); Launch Gate "Sentry"                                                                                  |
| Source        | `h-phase-close-out.md` "H-6 — Sentry source maps"; `docs/deployment.md` "Sentry source maps"                         |
| Why           | Code side done; never verified                                                                                       |
| Environment   | E5 + E6 · **MODIFIES PRODUCTION** (rebuilds and restarts `web`)                                                      |
| Prerequisites | **BLOCKED (BL-07)**; D-05's replacement `SENTRY_DSN` first; you edit the env file yourself (never paste values here) |
| State         | MODIFIES PRODUCTION                                                                                                  |
| Depends on    | D-05, C-12                                                                                                           |
| Closes        | H-6                                                                                                                  |

```bash
dc build web 2>&1 | grep -iE 'sentry|source ?map|debug id' | tail -20
dc up -d web && curl -sS "<NEXTAUTH_URL>/api/health"; echo
```

**Pass:** the build log shows the upload; the Sentry project lists the uploaded artifacts for this release; the next real web error event in Sentry shows a readable (source-mapped) stack. The repository has no route that raises a test error on purpose; if you want one, that is a code change for your decision. Record the event id, not its content.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-07)   [ ] SKIPPED
Evidence:    upload lines=   artifacts listed? [ ]   readable stack event id=
```

### D-07 — N9.14-F1 (5): legal review of the Custom REST Terms and Privacy drafts

|               |                                                                                       |
| ------------- | ------------------------------------------------------------------------------------- |
| Related       | N9.14, N9.14-F1 item (5); plan 09 Appendix A                                          |
| Source        | `implementation-plans/n9-legal-review.md`; roadmap N9.14 ("Terms/Privacy NOT edited") |
| Why           | Beta enablement requires it                                                           |
| Environment   | External (legal); listed under E5 in §2.1                                             |
| Prerequisites | **BLOCKED (BL-09)**                                                                   |
| State         | –                                                                                     |
| Depends on    | –                                                                                     |
| Closes        | N9.14-F1 item (5)                                                                     |

**Pass:** a written legal decision on each draft clause (approved / changed / rejected). Editing Terms and Privacy is a separate change afterwards.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-09)   [ ] SKIPPED
Evidence:    reviewer/date=   outcome per clause=
Follow-up 2026-10-10 (Claude Code): the review package is prepared in `implementation-plans/n9-legal-review.md` (section "Review package for the legal reviewer"): 15 verified facts with code references, 9 proposed clauses (P-1 to P-9), 6 issues in the existing copy (L-01 to L-06), 7 questions for counsel and an empty decision record. NOT a legal review and not legal advice; no clause is approved. D-07 stays BLOCKED (BL-09) until a qualified reviewer fills in the decision record.
             Findings the reviewer and the owner must see (live copy not edited):
             L-01/L-02: `PrivacyView.tsx` §4 states a fixed 90-day retention and deletion "according to our standard retention schedule" on disconnect or account closure; `docs/data-retention-and-on-call.md` says there is no retention window in the schema or code, data is kept until removal is requested, and disconnect is a soft hide. This concerns every provider, not only Custom REST, and is a candidate inaccurate public statement (needs an owner decision and counsel; H-5).
             L-03: Terms §2 and Privacy §2 say the service is read-only against every connected source; for Custom REST a customer-designated POST search endpoint is permitted (the client sends only GET or POST), and the draft addition "only sends read requests" omits that.
             F-15: Elapsed's outbound IP address is not documented or fixed, so a customer that allowlists IPs cannot be told one.
             Missing evidence for closure: the reviewer's written decision per clause (section 6 of the package), and an owner decision on L-01/L-02.
Follow-up 2 2026-10-10 (after the owner's D-07 instruction): the package was extended, not closed. New facts for the reviewer: F-16 (raw events and verified-404 deletion markers are permanent; no erasure on request; bears on L-01/L-02) and F-17 (Beta limits: 1,000 live tickets per source, a large deletion stops syncing; product limits, not commitments). Retention, disconnect, read-only (L-03) and outbound IP (F-15) remain documented as open findings. Status unchanged: BLOCKED on the qualified reviewer (BL-09). Legal review is NOT marked complete and the live Terms and Privacy text is untouched.
```

### D-08 — N9 focused tests of plan 09 §13 and §8.4 items 3–7

|               |                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | N9.5 exit, N9.2 (SSRF), N9.4 (mapping), N9.6–N9.9, N9.11, N9.13, N9.15; N9.14-F1 item (1)                                                                                                                        |
| Source        | Plan 09 §13 "Focused coverage that must exist before Beta enablement"; §8.4 "Verification required before Beta"                                                                                                  |
| Why           | `packages/custom-ticket/test` has 2 files; `packages/safe-http` has no `test/` directory; §13's areas are otherwise untested                                                                                     |
| Environment   | E2 (on `testing`)                                                                                                                                                                                                |
| Prerequisites | **BLOCKED (BL-04):** the tests must be written on `testing` when you ask for it                                                                                                                                  |
| State         | Disposable test database                                                                                                                                                                                         |
| Depends on    | B-03                                                                                                                                                                                                             |
| Closes        | N9.5 exit (§8.4 items 3–6; item 7, the rotation limitation in the deployment documentation, is **already satisfied**: `docs/deployment.md`, `INTEGRATION_TOKEN_ENCRYPTION_KEY` row), N9.14-F1 item (1) test half |

**Pass:** every §13 row has at least one test and all pass, in particular: §8.4 (3) unset/wrong key fails closed with a generic message; (4) the strict helper rejects an unprefixed value and each malformed form with one generic outcome; (5) a ciphertext moved to another organization, integration or field is rejected; (6) existing providers' `decryptToken` tests pass unmodified; the SSRF matrix; every boundary row of the §6.4 guards; the Q14/R5 rollback rows.

```text
RESULT
Status:      [x] PASS (2026-10-10, Follow-up 4: all §13 rows covered, 598 focused tests pass on `testing` and `main`)   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED   (earlier: BLOCKED by BL-04, then PARTIAL; kept in the follow-ups below)
Evidence:    test files=   §13 rows covered _/22   failures=
Follow-up 2026-10-10 (Claude Code, cloud session; branch claude/sharp-euler-gm4not, test-only commits dc6ad09, 5db1cb1, 3586f4c; NOT on origin/testing, see Deviations):
             test files written (13): packages/safe-http/test/{address,url,json,budget,client}.test.ts; packages/custom-ticket/test/{guards,path-and-dates,derive-history,pagination,overrides,validate-and-sla-modes}.test.ts; packages/db/test/custom-secrets.test.ts; packages/commitments/test/unsupported-kinds.test.ts
             focused run (`env -u DATABASE_URL npx vitest run` of exactly those files, no database used): Test Files 13 passed (13), Tests 451 passed (451), failed 0, skipped 0; mutation spot checks: removing the address check or the redirect refusal in `client.ts` made the matching tests fail (source restored)
             §13 coverage, by row (C = covered by a new test, P = partly, E = covered by an existing suite or an end-to-end record, N = no dedicated test):
               1 SSRF and the client: C (IPv4/IPv6 matrix, metadata names, mixed records, rebinding at connect time, TLS wrong certificate and SNI, redirects and loops, cross-origin next URL and Link, userinfo, ports, IP literals, size and compressed-body caps, timeouts, CRLF headers, credential-looking keys, method and POST designation). Gaps: P for "wrong SNI beyond the host name", HTTP/2 not applicable
               2 Mapping: P (path subset, prototype keys, wildcard, timezone required, DST gap and overlap, unknown status and the open fallback, unknown priority). N for transform determinism and payload_too_large
               3 Current state versus history: C (never fabricated, case_closed only at a source timestamp, updatedAt never substituted, identical output for different fetch times, real history at its timestamps)
               4 SLA exclusion: P (slaSupport parsing, per-kind exclusion in validation, stored support). N for the worker, connect-time and webhook gating and for "D24 replay shows 0 differences" (C-14 covers replay)
               5 SLA modes: C at configuration and derivation level (Resolution-only, Full, Q7 acknowledgement never defaulted, private notes, creation actor)
               6 Failure guard (Q2): C for the boundary table; P for the non-abort path (failed records excluded, rest derived); stored state of failed tickets unchanged: E (B-09)
               7 Lifecycle guard: C for the boundary table and "R < 10 never aborts"; E for "abort before projection, nothing written" (B-12 and the D-01 abort pass: content fingerprint identical)
               8 Deletion guard: C for the boundary table (including L = 101); E/N for "abort leaves everything unchanged" (not exercised end to end)
               9 Ceiling (Q13): C for L + N = C versus C + 1 and the configured value; N for "no rewrite, ingest does not start while over"
              10 Budget (Q4): C (120 s, attempts bounded by the remainder, no attempt at zero remaining, in-flight request aborted at expiry, retry and Retry-After clamped); N for "partial page not written, cursor at last completed page, resume"
              11 Partial runs and failures: E (B-09, B-11 end-to-end records; apps/web/test/custom-provider-failure-details and custom-sync-state-supersession); N for the §6.12 A-to-E table at unit level, three zero-progress runs = no_progress, and resume without duplicates
              12 Activation blocking (R6): N (no test for "no updated-since and a listing that does not fit one run is refused")
              13 Customer-facing states (R6): E (apps/web/test/custom-sync-state-supersession.test.ts, B-07 PASS); P otherwise
              14 Commitment cancellation and rollback (Q14, R5): C (dry-run writes nothing and shows counts including breached with closedAt null, stale hash rejected, only unfinalized commitments of the newly unsupported kind cancelled, finalized and other kinds untouched, nothing deleted, second run no-op, rollback to a version re-supporting Next Reply REFUSED, the cycle planner would restore a cancelled Next Reply which is why the rollback is refused). N for "version activation and cancellation commit together" (transaction) and "D24 replay checks (a)-(e)"; N for runCommitmentPipeline creating nothing for a cancelled first_response/resolution
              15 Override (Q15, R1, R2): C (only the lifecycle guard is skipped; ceiling, deletion and failure guards still fire; reason, bound hash, single use, 24 h expiry, void on a changed set, support path needs the owner's authorization and a distinct operator, operator cannot create it). N for member refusal and AdminAuditLog at route level (member refusal: E, B-12 closing run, 403)
              16 Beta flag (Q5): C at client level (stop before a run sends nothing, in-flight abort within the check interval, stop during back-off); E for routes and ingest (B-06 suites, B-13)
              17 Secrets (Q8, Q16): C (enc:v1 only, every malformed form one generic outcome, binding to organization, integration and field, unset or wrong key fails closed without an oracle, existing providers' paths unchanged); E for "sentinel never appears" (B-10)
              18 Synchronization: C (page, offset, cursor, next_url, Link header, loop detection, same-origin enforcement, 429 Retry-After clamped, child-page cap); N for resume after a crash mid-page and look-back overlap deduplication
              19 Deletion signals: C (absence never deletes, a source signal does, a restored ticket stays hidden when the marker came from a verified 404, a status or flag deletion is reversible at the source); N for writing the marker on a verified 404
              20 Tenant isolation: E (B-05: classification and seeds on main, 2 of 2 files, 87 tests)
              21 No-change runs (D32): E (B-07: sync-history-no-change.db, custom-sync-state-supersession)
              22 Regression: E (B-07 PASS, 26 files, 293 tests)
             Rows with NO dedicated automated test: 12 (activation blocking) and the unit-level parts of 11. Rows partly without: 2, 4, 8, 9, 10, 14, 18, 19. D-08's pass condition ("every §13 row has at least one test and all pass") is therefore NOT yet met.
Follow-up 2 2026-10-10 (Claude Code; commit 8060a0d, test-only, same branch):
             new test files: packages/custom-ticket/test/ingest-runs.db.test.ts (13 tests, real database sla_e2e_test, local fixture helpdesk, private hosts enabled only inside the test), packages/custom-ticket/test/full-pass-activation.test.ts (3), packages/custom-ticket/test/ingest-fixtures.ts (helper), apps/web/test/custom-attention-copy.test.ts (9); guards.test.ts follows the 1,000 default. `ingest-runs.db.test.ts` is registered in `vitest.config.ts` `realDatabaseSuites`.
             focused run: `npx vitest run packages/custom-ticket packages/safe-http packages/db/test/custom-secrets.test.ts packages/commitments/test/unsupported-kinds.test.ts apps/web/test/custom-{attention-copy,sync-state-supersession,provider-failure-details,sync-history-view}.test.ts`: Test Files 22 passed (22), Tests 512 passed (512), failed 0. Type checks: `tsc --noEmit` in apps/web and packages/custom-ticket clean. The full suite was not run (CLAUDE.md).
             row coverage changes (C = dedicated test):
               8  Deletion guard: now C end to end (4 of 10 markers abort with `mass_deletion`, cases/events identical before and after; 3 markers apply)
               9  Ceiling: now C end to end (C = L + N passes, C - 1 aborts with nothing written; a lowered setting leaves stored data untouched). FINDING: tickets already deleted still count toward N (they stay in the stored set), so a ceiling of 4 aborts with 4 live cases plus 1 deleted ticket. Conservative and consistent with the whole-set cost, but it means deleted tickets permanently consume ceiling; to be stated in the setup guidance, not changed
               10 Budget: C for partial-page-not-written (crash before commit leaves cursor at the last completed page) and resume. The 120 s wall clock itself is not exercised end to end (budget exhaustion is forced by making the attempt start throw the code the real budget throws)
               11 Partial runs: now C at ingest level for §6.12 rows A (completed pass with a record failure is a normal run that reports it), B/E (page cap ends the run `partial` at the last completed page, failures reported, next run finishes), D (provider failure after completed pages: failed run, pages kept, resume after them); three zero-progress runs then `no_progress`, counter reset, and reset by a completed page. Row C (budget stop plus the failed-record guard firing) is covered only at guard level (guards.test.ts) and by the worker's sync-runs tests: still P
               12 Activation blocking (R6): now C for the check `activateDraft` uses (`measureFullPass`: a listing over 50 pages is refused with `run_cap_reached`, a small one passes, a provider failure is not "completed"). The `activateDraft` wrapper that turns it into `listing_too_large` is one branch and has no isolated test: P
               13 States: C for the cause mapping (own message per guard, partial with and without an incremental cursor, no_progress)
               18 Synchronization: now C for resume after a crash mid-page, same window anchor, watermark moves only when the pass completes
               19 Deletion signals: now C for the verified-404 marker write (404 writes one permanent `ticket_deleted:` marker; 400 writes none; absence from the list alone never deletes)
             Rows still without a dedicated test or only partly covered: 2 (transform determinism, payload_too_large), 4 (worker, connect-time and webhook gating of unsupported kinds), 11 row C end to end, 12 wrapper, 14 (parts). D-08's pass condition is therefore STILL NOT met; status stays PARTIAL/open.
             Integration into `testing` (prepared, NOT executed; CLAUDE.md forbids merging main into testing unless explicitly asked): origin/testing is 52 commits behind origin/main and has none of the 33 `packages/custom-ticket` / `packages/safe-http` source files, so these tests cannot run there until main's custom-provider sources arrive. Plan: (1) the owner authorizes `git merge origin/main` into `testing` (or a rebase of testing onto main); (2) cherry-pick the test-only commits dc6ad09, 5db1cb1, 3586f4c, 8060a0d (they touch only `*/test/**` and `vitest.config.ts`; 8060a0d's `guards.test.ts` edit expects the 1,000 default from 8b123a5, so 8b123a5 must be present first); (3) run the focused command above on `testing` and keep the product commits (8b123a5, dd5a2d9, d6a9adb) on main only; (4) never merge testing back into main. Until then the tests live on claude/sharp-euler-gm4not beside the code they test.
Follow-up 3 2026-10-10 (Claude Code; commits e888a54, b240a17; test-only b240a17):
             new tests: apps/web/test/{custom-sla-support-gating (real DB, row 4 and R5), custom-activation-atomicity (real DB, row 14: a failure at the audit step rolls back version, pointer and cancellations; a confirmed activation commits all together, finalized commitments untouched, nothing deleted), custom-activation-blocking (row 12: `listing_too_large` wrapper), guard-override-operator (U6 permission and Compose wiring)}.test.ts; apps/worker/test/classify-run-partial-table.test.ts (§6.12 classification order and rows A to E, including row C); packages/custom-ticket/test/transforms-determinism.test.ts (row 2); `payload_too_large` and the runbook SQL added to ingest-runs.db.test.ts. Real-database suites are registered in `vitest.config.ts`.
             focused run (31 files): Test Files 31 passed (31), Tests 598 passed (598), failed 0. Type checks: `tsc --noEmit` clean in apps/web, apps/worker, packages/custom-ticket; packages/db has one pre-existing rootDir error (TS6059, generated client), identical before and after these commits. Full suite not run (CLAUDE.md).
             Row status now: every §13 row (1 to 22) has at least one dedicated or end-to-end test, except the explicitly external parts: D24 replay (C-14, Phase C), and the real 120 s wall clock (budget exhaustion is forced in tests; the budget itself is covered by safe-http budget.test.ts with an injected clock). D-08's code-side pass condition is met on the branch claude/sharp-euler-gm4not.
             NOT done: integration into `origin/testing`. The attempt to merge origin/main into a local testing worktree was refused by the environment's permission layer (shared-branch modification), so nothing was merged, committed or pushed to testing or main (the temporary worktree was removed; origin/testing is unchanged at ad5b6f0). Exact sequence ready to run once permitted: (1) `git checkout -B testing origin/testing && git merge --no-ff origin/main` (52 commits, no expected conflicts: testing has 0 commits main lacks); (2) `git cherry-pick e888a54 8b123a5` (the two product commits the tests depend on: ceiling default 1,000, abort copy, Compose wiring) and then the test-only commits `dc6ad09 5db1cb1 3586f4c 8060a0d b240a17`; (3) run the focused command and `tsc --noEmit` on testing; (4) push testing. Product commits then reach main through the branch's own review, and git treats the identical patches as already applied. D-08 therefore stays OPEN on the branch-integration criterion only.
Follow-up 4 2026-10-10 (Claude Code; owner authorized modifying `testing`): INTEGRATED. Because the product and test commits had already been fast-forwarded to `main` (b533624, on the owner's instruction), the only step needed was `git merge --no-ff origin/main` into `testing` (74 commits behind, 0 ahead, no conflicts, clean working tree before and after): merge commit 23f265b, pushed as ad5b6f0..23f265b (no force). On `testing` after `pnpm install --offline --frozen-lockfile`, `prisma generate` and `pnpm build`: focused run Test Files 31 passed (31), Tests 598 passed (598); `tsc --noEmit` clean in apps/web, apps/worker and packages/custom-ticket. The tests therefore live on `testing` and on `main`. D-08 is PASS for its code-side pass condition; the 120 s wall clock and D24 replay (C-14) remain with Phase C as recorded.
Deviations:  (1) Written on the branch that contains main, not on origin/testing: origin/testing is 52 commits behind main and has no packages/custom-ticket or packages/safe-http sources, so these tests cannot run there until main is merged into testing, which CLAUDE.md allows only when the owner asks. The commits are test-only and can be cherry-picked. (2) The test counts above were produced on this branch only. (3) packages/safe-http now has a test/ directory; no test-runner script was added to packages/safe-http/package.json (it already has `test: vitest run`).
```

---

## 8. Phase E — Final acceptance

### E-01 — Evidence review and file integrity

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| Related       | Every check; roadmap "Task completion verification"                          |
| Source        | Roadmap "How This Roadmap Works" §3 and "Task completion verification"       |
| Why           | A task is ticked only when its own criteria pass, not when a command exits 0 |
| Environment   | E1                                                                           |
| Prerequisites | Every other check has a filled RESULT                                        |
| State         | READ-ONLY                                                                    |
| Depends on    | all                                                                          |
| Closes        | Hand-over of this file                                                       |

```bash
f=docs/validation/server-validation-master.md
grep -oE '^### [A-E]-[0-9]+' "$f" | sort | uniq -d                 # duplicate check IDs: must print nothing
grep -cE '^Status: +\[ \] PASS' "$f"                                 # unfilled status lines remaining
git diff --check
```

**Pass:** no duplicate IDs; every RESULT has one box ticked; every FAIL has its _On failure_ steps recorded; every BLOCKED names its prerequisite; for each item in §9 you can point at the checks that meet its "Evidence needed".

```text
RESULT
Status:      [ ] PASS   [ ] FAIL
Evidence:    duplicates=   unfilled=   FAIL list=   BLOCKED list=
```

### E-02 — Full regression suite on `testing` after you sync it with `main`

|               |                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Related       | DC-15; CLAUDE.md "On `testing`"; roadmap Rev 7 baseline (258 files / 2,766 tests)                                                        |
| Source        | `CLAUDE.md` ("`testing` is based on `main` … only synchronize when explicitly asked"); `.github/workflows/ci.yml` (golden-scenario step) |
| Why           | No full run of the merged N9/N10 code exists; CI runs only on `testing`, which is 35 commits behind `main`                               |
| Environment   | E2                                                                                                                                       |
| Prerequisites | **Your explicit decision to merge `main` into `testing`** (OD-04); B-03                                                                  |
| State         | Merges into a local `testing` worktree (push is your decision); truncates `sla_validation_test`                                          |
| Depends on    | B-07, B-06                                                                                                                               |
| Closes        | DC-15; the regression half of N9.14-F1 (1); "Remote CI is green" for the next phase PR once pushed                                       |

```bash
git worktree add ~/elapsed-validation/testing origin/testing && cd ~/elapsed-validation/testing
git switch -c testing-sync && git merge --no-ff origin/main      # resolve conflicts on testing only
pnpm install --frozen-lockfile && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @sla/db generate
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
pnpm type-check && pnpm test:db:prepare && pnpm test
npx vitest run apps/web/test/sla-golden-scenarios.test.ts apps/web/test/sla-e2e-matrix.test.ts
```

**Pass:** `pnpm test` exits 0 (the three known failures of B-07 fixed on `testing`, or listed with your acceptance); golden and e2e-matrix pass, not skipped; record files and tests. If you push the branch, CI on `testing` must be green.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED (OD-04)   [ ] SKIPPED
Evidence:    files=   tests=   failed=   skipped=   golden/e2e=   CI run (if pushed)=
```

### E-03 — Documentation closure (procedure, after you return this file)

|             |                                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Related     | Every row of §9                                                        |
| Source      | Roadmap "How This Roadmap Works" (Complete, Close the phase, Continue) |
| Environment | E1 (documentation only)                                                |
| State       | Edits documentation only                                               |
| Depends on  | E-01                                                                   |
| Closes      | The documentation state of every item whose evidence passed            |

For each row of §9 whose evidence passed, update the listed documents in one documentation change: tick or annotate the roadmap tasks with the date and check IDs, update the Status Board (deployed commit from C-12, N4.7 counts from C-17), correct every DC row that the evidence settles, and add a changelog entry. Rows whose evidence failed or is blocked keep their current status with the exact blocker. I make these edits when you send the completed file back; nothing in this step runs a command.

```text
RESULT
Status:      [ ] DONE   [ ] PARTIAL (rows left open listed below)
Evidence:    documents changed=          rows closed=          rows left open=
```

---

## 9. Documentation closure map

| Item                                                                    | Current state                                     | Evidence needed to close                                                                                                                                                                    | Documents to update on success                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status Board, phase overview, N9/N10 status lines (DC-01, DC-15, DC-16) | Stale: says N10 unpushed; deployed state unknown  | A-03, A-04, B-01, B-02, C-12                                                                                                                                                                | `ROADMAP_Product.md` Status Board, Phase overview, N9 and N10 status lines, Changelog                                                                                                                 |
| Release of N2–N10 ("built, not deployed")                               | Not deployed (last recorded production `7cb2b9b`) | C-01–C-08 PASS, C-11 DONE, C-12 PASS                                                                                                                                                        | Roadmap Status Board ("Stage", deployed commit and date); `h-phase-close-out.md` Release row (13 migrations, DC-05)                                                                                   |
| 7.3 restore drill timing                                                | Ticked; log missing (DC-07)                       | C-02                                                                                                                                                                                        | Commit `docs/restore-drills.log`; roadmap 7.3 note                                                                                                                                                    |
| H-5 "not verified" lines                                                | Unverified on host                                | A-06, A-07, A-08, C-15                                                                                                                                                                      | `docs/data-retention-and-on-call.md` (Sentry, ops alerts, cron/off-site, log rotation, `db:encrypt-tokens`)                                                                                           |
| H-6                                                                     | Open                                              | D-06 (after D-05)                                                                                                                                                                           | Roadmap H-6; `h-phase-close-out.md` H-6                                                                                                                                                               |
| H-8                                                                     | Blocked upstream                                  | A-11 + OD-06 (then a lint step, implementation)                                                                                                                                             | Roadmap H-8                                                                                                                                                                                           |
| H-10                                                                    | Open                                              | C-15 PASS, D-05 PASS, OD-07, OD-12                                                                                                                                                          | Roadmap H-10; `docs/deployment.md` rotation log; `h-phase-close-out.md` H-10                                                                                                                          |
| H-13                                                                    | Open (host run)                                   | C-10, C-13, C-14                                                                                                                                                                            | Roadmap H-13 (closed with counts); `h-phase-close-out.md` H-13 row                                                                                                                                    |
| N1.13                                                                   | `[~]`                                             | D-04 (capture) + C-06 (L2)                                                                                                                                                                  | Roadmap N1.13; `h-phase-close-out.md` N1.13 row                                                                                                                                                       |
| N2.10                                                                   | `[~]`, held out                                   | C-09, then C-16                                                                                                                                                                             | Roadmap N2.10; contract `README.md` (moved); `h-phase-close-out.md` N2.10 row                                                                                                                         |
| N2.11 / N2 phase                                                        | `[~]`                                             | N2.10 closed + C-14 (OD-11)                                                                                                                                                                 | Roadmap N2.11, N2 status, phase overview                                                                                                                                                              |
| N3.6                                                                    | `[~]`                                             | D-02                                                                                                                                                                                        | Roadmap N3.6                                                                                                                                                                                          |
| N3.7 / N3 phase                                                         | Open, evidence-gated                              | C-18 (≥ 3 weeks) + your record "not needed, measured at X" or a trigger                                                                                                                     | Roadmap N3.7, N3 status                                                                                                                                                                               |
| N4.7 / N4 phase                                                         | Open (data)                                       | OD-07, C-17                                                                                                                                                                                 | Roadmap N4.7 (counts), N4 status, Status Board                                                                                                                                                        |
| N5.8 / H-9 / 6.8 / N5 phase                                             | Open                                              | D-03                                                                                                                                                                                        | Roadmap N5.8, H-9, 6.8 note; `h-phase-close-out.md` H-9                                                                                                                                               |
| N6.4 (D27 gap)                                                          | Done with a documented gap                        | OD-02                                                                                                                                                                                       | Roadmap D27, N6.4; plan 06                                                                                                                                                                            |
| N6.5                                                                    | Not started (gated)                               | OD-03 + go-ahead                                                                                                                                                                            | –                                                                                                                                                                                                     |
| N9.0-F1 / F2 / F3                                                       | Open                                              | OD-09 (F1, F2), OD-01 (F3)                                                                                                                                                                  | Roadmap N9.0 follow-ups (DC-04)                                                                                                                                                                       |
| N9.5 exit (§8.4)                                                        | Not run                                           | B-03, B-05, B-10, D-08                                                                                                                                                                      | Roadmap N9.5                                                                                                                                                                                          |
| N9.6 / N9.7 / N9.9 / N9.15 behavior                                     | Not run against a database                        | B-09, B-11, B-12, B-13                                                                                                                                                                      | Roadmap N9.6, N9.7, N9.9, N9.15 notes                                                                                                                                                                 |
| N9.8a / N9.9 / N9.10 / N9.13 / N9.15 D24 + regression                   | "Not run"                                         | C-06, C-07 (replay); B-07, B-16 (regression/flow)                                                                                                                                           | Roadmap N9.8a, N9.9, N9.10, N9.13, N9.15                                                                                                                                                              |
| N9.11 / N9.12                                                           | "Not exercised"                                   | B-09–B-16                                                                                                                                                                                   | Roadmap N9.11, N9.12                                                                                                                                                                                  |
| N9.7-F1                                                                 | Open (benchmark done, C = 1,000 provisional; deploy of the setting pending) | D-01 + OD-08 (decided) + deploying the Compose change                                                                                                                                                         | Roadmap N9.7, N9.7-F1 (harness path, DC-03); plan 09 §6.9–§6.10; `docs/capacity-limits.md`                                                                                                            |
| N9.14-F1 (Beta)                                                         | Blocked, enforced in code                         | Items (1) B-03, B-05, B-07, B-10, C-05–C-07, D-08; (2) B-09–B-16; (3) D-01; (4) OD-01; (5) D-07 — then a reviewed code change lifting the block in `packages/db/src/integration-catalog.ts` | Roadmap N9.14-F1; `docs/integration-availability.md` "Rollout block"; public docs and `plans.ts` copy (separate change)                                                                               |
| N10.7                                                                   | Open (tests not in the repository, DC-02)         | Push `testing-n10` + B-06                                                                                                                                                                   | Roadmap N10.7; plan 10 §10                                                                                                                                                                            |
| N10 phase done-when                                                     | 6/7                                               | B-06, B-13, B-14, B-15, C-12                                                                                                                                                                | Roadmap N10 status → ✅ with the merge commit `0e48d28`; phase overview                                                                                                                               |
| N10-F1                                                                  | Not written                                       | After C-12, OD-05; the contract migration does not exist yet (implementation)                                                                                                               | Roadmap N10-F1                                                                                                                                                                                        |
| Runbook commands (DC-06, DC-17)                                         | Inconsistent env file / database names            | A-03                                                                                                                                                                                        | `docs/deployment.md`, `deployment-runbook.md`, `h-phase-close-out.md`, `n2-replay-runbook.md`; `scripts/prod/h10-verify.sh` check 3 and `n47-plan-records.sql` header (script changes: your approval) |
| 10 live customers (DC-08)                                               | Unlocated in the queried database                 | A-09 + OD-07                                                                                                                                                                                | Roadmap Status Board, H-1 limitation                                                                                                                                                                  |
| Monthly report default (DC-19)                                          | Turns on with the release                         | C-08 + OD-13                                                                                                                                                                                | Roadmap N5.6 note; release notes in `h-phase-close-out.md`                                                                                                                                            |
| Launch Gate                                                             | Superseded, never ticked                          | none (by rule, not ticked retroactively)                                                                                                                                                    | –                                                                                                                                                                                                     |

---

## 10. Check index (IDs, dependencies, state)

| ID   | Title                               | Env      | Depends on               | State                                |
| ---- | ----------------------------------- | -------- | ------------------------ | ------------------------------------ |
| A-01 | Local repository and toolchain      | E1       | –                        | read-only                            |
| A-02 | Branch inventory                    | E1       | A-01                     | read-only                            |
| A-03 | Host inventory                      | E6       | –                        | read-only                            |
| A-04 | Production migration state          | E6       | A-03                     | read-only                            |
| A-05 | Health endpoints                    | E6       | A-03                     | read-only                            |
| A-06 | Runtime configuration names         | E6       | A-03                     | read-only                            |
| A-07 | Scheduled backups                   | E6       | A-03                     | read-only                            |
| A-08 | Log rotation, disk                  | E6       | A-03                     | read-only                            |
| A-09 | Tenant/provider counts              | E6       | A-03                     | read-only                            |
| A-10 | Host hardware                       | E6       | –                        | read-only                            |
| A-11 | Upstream lint support               | E1       | –                        | read-only                            |
| B-01 | Generate + type-check               | E1       | A-01                     | local build output                   |
| B-02 | Builds                              | E1       | B-01                     | local build output                   |
| B-03 | Migrations on empty DB, drift       | E2       | B-01                     | disposable DB                        |
| B-04 | N2.10 artefacts on current schema   | E2       | B-03                     | disposable DB                        |
| B-05 | Tenant-scope classification         | E2       | B-03                     | disposable DB · BLOCKED              |
| B-06 | N10 focused suites                  | E2       | B-03, A-02               | disposable DB · BLOCKED              |
| B-07 | Existing regression suites          | E2       | B-03                     | disposable DB                        |
| B-08 | Local E2E stack                     | E3       | B-01                     | disposable DB                        |
| B-09 | Custom REST E2E + partial import    | E3       | B-08                     | disposable DB                        |
| B-10 | Secret sentinel scan                | E3       | B-09 (repeat after B-11) | read-only                            |
| B-11 | Failure classes                     | E3       | B-09                     | disposable DB                        |
| B-12 | Lifecycle guard + override          | E3       | B-11                     | disposable DB                        |
| B-13 | In-flight availability abort        | E3       | B-12                     | disposable DB                        |
| B-14 | Built-in provider disable/re-enable | E3       | B-08 (after B-13)        | disposable DB                        |
| B-15 | Rollout block                       | E3       | B-08                     | disposable DB                        |
| B-16 | Unsupported kinds, rollback guard   | E3       | B-09 (after B-13)        | disposable DB                        |
| C-01 | Production backup                   | E6       | A-03, A-07, A-08         | read-only DB; file on host           |
| C-02 | Host restore drill                  | E6       | C-01                     | scratch DB on host                   |
| C-03 | Local restore                       | E4       | C-01                     | local restore                        |
| C-04 | L1 baseline (deployed code)         | E4       | C-03                     | read-only                            |
| C-05 | Migrate restore with `main`         | E4       | C-04                     | local restore                        |
| C-06 | L2 replay ×2                        | E4       | C-05                     | local restore                        |
| C-07 | L1 compare                          | E4       | C-06                     | read-only                            |
| C-08 | Post-migration assertions           | E4       | C-05                     | read-only                            |
| C-09 | N2.10 apply + rollback on restore   | E4       | C-07                     | local restore                        |
| C-10 | H-13 rehearsal                      | E4       | C-07 (after C-09)        | local restore                        |
| C-11 | Release (GATED)                     | E6       | CHECKPOINT C1, OD-05     | **modifies production**              |
| C-12 | Post-release verification           | E6       | C-11                     | read-only                            |
| C-13 | H-13 production backfill (GATED)    | E6       | C-10, C-12, OD-05        | **modifies production**              |
| C-14 | Post-release drift capture          | E4       | C-12 (after C-13)        | read-only on production              |
| C-15 | H-10 host verification              | E6       | A-03 (after C-12)        | read-only                            |
| C-16 | N2.10 release (GATED)               | E6       | C-09, C-14, OD-05        | **modifies production**              |
| C-17 | N4.7 counts                         | E6       | C-12, OD-07              | read-only (your UI data entry first) |
| C-18 | Weekly production measurements      | E6       | C-12                     | read-only                            |
| D-01 | Benchmark gate                      | E4       | A-10, OD-08              | PASS (provisional Beta safeguard)    |
| D-02 | Outage drill                        | E4       | A-10                     | BLOCKED                              |
| D-03 | Live onboarding per pair            | E5       | B-02                     | BLOCKED                              |
| D-04 | Intercom → Linear link shape        | E5       | –                        | BLOCKED                              |
| D-05 | Third-party rotation (GATED)        | E6       | C-15                     | BLOCKED · **modifies production**    |
| D-06 | Sentry source maps (GATED)          | E5/E6    | D-05, C-12               | BLOCKED · **modifies production**    |
| D-07 | Legal review                        | external | –                        | BLOCKED                              |
| D-08 | N9 focused tests                    | E2       | B-03                     | PASS (code side; see Follow-up 4)                              |
| E-01 | Evidence review                     | E1       | all                      | read-only                            |
| E-02 | Full suite on synced `testing`      | E2       | B-06, B-07, OD-04        | local branch                         |

**Independent starting points:** A-01, A-02, A-11 (local) and A-03, A-10 (host) can start at once; Phase B can run in parallel with C-01–C-10; every D item waits only on its own prerequisite.

**First safe check:** **A-01** on your machine (read-only), then **A-03** on the host (read-only), whose confirmed `ENV_FILE` and `APP_DB` every later host command uses.
