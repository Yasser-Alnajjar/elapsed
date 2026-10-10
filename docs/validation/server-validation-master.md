# Server validation master checklist

**One file for every outstanding validation needed to close Elapsed's documented work: instructions, commands, pass criteria and the results you record.** Fill in the `RESULT` block under each check in place and send this file back. No other spreadsheet or report is needed.

| | |
| --- | --- |
| Prepared | 2026-10-09 (UTC), repository audit at `main` = `0e48d28` (merge of PR #49, N10) |
| Scope | Every roadmap phase (historical 0–7, Production Hygiene H-1–H-13, N1–N10), the Launch Gate, decisions D1–D33, plans 01–10, runbooks, scripts, CI, migrations and the code paths they describe |
| Not in scope | Building features, writing tests, changing application behavior, approved decisions or performance limits. Where a check needs any of those first, it is marked **BLOCKED** with the prerequisite |
| Owner of execution | You. Run checks one by one, in phase order, and stop at every checkpoint that fails |

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
- **FAIL**: stop, fill in the block, and follow the check's *On failure* section. Do not continue past the next checkpoint.
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

| Code | Environment | Used for |
| --- | --- | --- |
| **E1** | Local static check (no database) | type-check, builds, `git` inspection |
| **E2** | Isolated disposable test database (local Docker Postgres from `docker-compose.dev.yml`) | migrations on an empty schema, focused test suites |
| **E3** | Local Docker/full stack (web + worker + mock provider + disposable DB) | end-to-end workflows |
| **E4** | Staging / production-equivalent server or a restored production backup on an isolated database | replay, drills, benchmarks |
| **E5** | External provider sandbox or test account | live OAuth walkthroughs, Sentry |
| **E6** | Production, safe operational check (read-only, or an explicitly gated owner action) | inventory, health, backups, deployment |
| **E7** | No new check: adequate evidence already exists | cited in §3 |

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

| Can run in parallel | Must wait |
| --- | --- |
| A-01, A-02, A-11 (local) with A-03–A-10 (host) | Every host check after A-03 needs A-03's confirmed `ENV_FILE` and `APP_DB` |
| All of Phase B with Phase C1 (different machines/databases) | C-04 needs C-03; C-05 needs C-04; C-06/C-07 need C-05 |
| Phase D items with everything else | C-11 (release) needs CHECKPOINT B **and** CHECKPOINT C1 **and** your gate |
| | E-02 needs your explicit decision to sync `main` into `testing` |

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

| Phase | E1 | E2 | E3 | E4 | E5 / external | E6 | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — preflight | 3 | – | – | – | – | 8 | **11** |
| B — isolated | 2 | 5 | 9 | – | – | – | **16** |
| C — server | – | – | – | 9 | – | 9 | **18** |
| D — external / missing infrastructure | – | 1 | – | 2 | 4 | 1 | **8** |
| E — final acceptance | 1 | 1 | – | – | – | – | **2** (+ E-03, a documentation procedure) |
| **Total** | 6 | 7 | 9 | 11 | 4 | 18 | **55 checks + E-03** |

Status at hand-over:
- **Adequate evidence, no check:** the items in §3.
- **Partly evidenced by the auditor's pre-run (no database, no tests):** B-01 (type-check PASS; `validate` still yours) and B-04 (part 1 PASS; part 2 yours).
- **Outstanding:** all 55 checks need your run or your action.
- **BLOCKED on a prerequisite (10):** B-05, B-06, D-01, D-02, D-03, D-04, D-06, D-05, D-07, D-08.
- **Owner-gated actions that modify production (5):** C-11, C-13, C-16, D-06, D-05; plus your N4.7 data entry before C-17.

### 2.2 Blockers that need infrastructure, provider access or an owner decision

| # | Blocker | Blocks | Kind |
| --- | --- | --- | --- |
| BL-01 | The plan 09 §6.10 benchmark harness does not exist. The roadmap points to `packages/custom-ticket/bench/`, which is not in the repository; `apps/worker/scripts/bench/run.ts` is the multi-worker soak harness, not the §6.10 benchmark | D-01, N9.7-F1, N9.14-F1 | Missing infrastructure (test tooling, `testing` branch) |
| BL-02 | No production-equivalent host specification is recorded (the EC2 size is "not recorded in the repo", `docs/capacity-limits.md`) | D-01, D-02 | Infrastructure (A-10 records it) |
| BL-03 | The N10.7 test files exist only on your local `testing-n10` branch: none of the 8 suites is on `main` or `origin/testing`, and `origin/testing-n10` does not exist | B-06, N10.7 | Branch not pushed |
| BL-04 | The N9 focused tests (plan 09 §13, §8.4 items 1–7) are not written; `tenant-scope-classification` and `tenant-isolation` have no entries for the 7 N9/N10 models | B-05, D-08, N9.5 exit, N9.14-F1 (1) | Test authoring on `testing` (you must ask for it) |
| BL-05 | No outage-injection harness for N3.6's production-scale 2-hour drill (the fake provider in `apps/worker/scripts/bench` only adds latency) and no staging host | D-02, N3.6, N3 "Phase is done when" | Missing infrastructure |
| BL-06 | Zendesk sandbox login + OAuth client (required); Intercom and Linear sandbox workspaces with OAuth apps | D-03, D-04, N5.8, H-9, 6.8, N1.13 | External provider accounts |
| BL-07 | Sentry auth token (`project:releases`, `org:read`), org and project slug; a replacement `SENTRY_DSN` | D-06, H-6 | Secret / access |
| BL-08 | Replacement of the leaked `OPS_ALERT_SMTP_PASSWORD` (and the ops SMTP account decision) and `SENTRY_DSN` at their providers | D-05, H-10 | Third-party secrets |
| BL-09 | Legal review of `implementation-plans/n9-legal-review.md` | D-07, N9.14-F1 (5) | External (legal) |
| BL-10 | `GUARD_OVERRIDE_OPERATOR_EMAILS` and `CUSTOM_PROVIDER_LIVE_CASE_CEILING` are read by the code but not passed to any container by `docker-compose.yml`, so neither can be set in production today | The support-assisted override path; applying the benchmarked ceiling | Configuration gap (record; not fixed here) |
| BL-11 | `typescript-eslint` does not support TypeScript 7 (A-11 re-checks) | H-8, 7.10 lint half | Upstream |
| OD-01 … OD-12 | Owner decisions, §2.4 | various | Owner |

### 2.3 Documentation conflicts, stale claims and unsupported completion claims

Recorded, **not resolved** here. Each needs your decision or a documentation update in E-03.

| ID | Where | Claim | What the repository shows | Effect on this plan |
| --- | --- | --- | --- | --- |
| DC-01 | Roadmap Status Board "Now", phase overview, N10 status line | N10 "not pushed, no PR yet"; N10.1–N10.6 "committed on the phase branch, not pushed" | `main` = `0e48d28`, "Merge pull request #49 … phase/n10-integration-control-center" | N10 is on `main`; status lines are stale (E-03) |
| DC-02 | Roadmap N10.7; plan 10 §10 "As built" | 8 suites / 72 tests passing; "the four real-database suites are listed in `vitest.config.ts`" | None of the 8 files is on `main` or `origin/testing`; `vitest.config.ts` on `main` lists none of them | N10.7 evidence is not in the repository (BL-03, B-06) |
| DC-03 | Roadmap N9.7-F1 | "Harness: `packages/custom-ticket/bench/`" | Path does not exist | BL-01 |
| DC-04 | Roadmap N9.0-F2, Rev 8 changelog | The copy-only change on `copy/docs-reconciliation-30min` "awaits review" | `origin/copy/docs-reconciliation-30min` is an ancestor of `main` (merged) | N9.0-F2 needs only your confirmation (OD-09) |
| DC-05 | `docs/h-phase-close-out.md` "Remaining owner actions", Release row | 7 pending migrations (`20261001100000` … `20261004100000`) after `7cb2b9b`; safety evidence from 2026-10-05 | 13 migrations after `7cb2b9b` (adds 5 N9 and 1 N10). The 6 new ones were never applied to a production-backup restore | C-05, C-07, C-08 re-establish the evidence |
| DC-06 | `docs/deployment.md`, `deployment-runbook.md`, `h-phase-close-out.md` (H-1, H-4, H-10, N4.7 commands), `scripts/prod/h10-verify.sh`, `scripts/prod/n47-plan-records.sql` header, `scripts/restore-drill.sh`, `scripts/backup.sh` defaults | Host uses `.env.prod` and the container's `$POSTGRES_DB` | `docs/production-backup-runbook.md` and `n2-replay-runbook.md` ([host] notes): the host uses `.env` and the data is in `elapsed_db`; `$POSTGRES_DB` (`sla_breach_monitoring`) is empty. **`h10-verify.sh` check 3 queries `$POSTGRES_DB`, so it can PASS vacuously; `backup.sh` without `DB_NAME` dumps the empty database** | Every host command here names `$ENV_FILE` / `$APP_DB` explicitly; A-07 checks the scheduled dumps; C-15 replaces check 3 |
| DC-07 | Roadmap 7.3 (ticked) | "The drill timing belongs in `docs/restore-drills.log` — add the line if it isn't committed yet" | `docs/restore-drills.log` has never been committed | C-02 |
| DC-08 | Roadmap Status Board "10 customers"; H-1 evidence | 10 live customers | H-1's read-only query of `elapsed_db` found 12 organizations: 11 `seed-org-*` fixtures and 1 dev sandbox. The 10 customers' data was never located | OD-07; A-09 re-counts |
| DC-09 | `h-phase-close-out.md` "H-10 code audit" | "all 71 API routes re-audited" | 99 `route.ts` files now (N4–N10 added 28). N4/N10 routes have their own authz tests; the N9 custom routes have never been exercised | B-09–B-16 exercise them; H-10's "authorization audit current" needs OD-12 |
| DC-10 | Plan 09 §8.6, N9.5 | New models need tenant-scope classification and isolation seeding | 0 entries for `IntegrationSyncRun`, `CustomProviderDraft`, `CustomProviderConfigVersion`, `GuardOverride`, `CustomActivationAudit`, `IntegrationAvailability`, `IntegrationBetaAllowlist` | BL-04, B-05 |
| DC-11 | Roadmap D27 + Status Board "Blocked on decisions" | D27 interpretation (2026-10-05): "new cases" = newly ingested cases; Status Board: pending confirmation whether it means manually created cases | The two statements disagree; the code blocks neither | OD-02 |
| DC-12 | Roadmap N1.18 text | "the production-backup replay is not done" | Rev 6 reconciliation and N2.11: the host replay ran 2026-10-01 (L1 0 / 5,440, L2 0 / 7,413) | Stale wording only; N1 evidence is adequate (§3) |
| DC-13 | `h-phase-close-out.md` Release row | "After deploying, re-run the replay on the host" | Not defined how, once live data has moved past the baseline | C-14 proposes a measurable form (drift capture); OD-11 |
| DC-14 | `apps/web/test/custom-sync-state-supersession.test.ts` on `main` | Sets `Organization.customProviderEnabled` | That column is unread since N10 (availability comes from `integration_beta_allowlist`); the D33 update of this suite is on `testing-n10` only | Expected failure recorded in B-07 |
| DC-15 | Roadmap Status Board "Code on `main` (verified 2026-10-05, Rev 7) … 258 files / 2,766 tests" | Current verification | N9 (PR #48) and N10 (PR #49) merged afterwards; no full-suite run on the merged HEAD is recorded | B-01, B-02, E-02 |
| DC-16 | Roadmap N9 phase line "N9.1–N9.14 implemented … unverified against a database" | | N10.1 records the N9 and N10 migrations applied to a fresh scratch database on 2026-10-09 (not a production restore; no route or flow run) | Partly stale; B-03, B-09–B-16, C-05 |
| DC-17 | `n2-replay-runbook.md` §1, `restore-drill.sh`, `data-retention-and-on-call.md` "Documentation gap" | `docker-compose.prod.yml` | Removed from the repository; production runs `docker-compose.yml` | Commands here use `docker-compose.yml` |
| DC-18 | `.github/workflows/ci.yml` comment on the `postgres` service | "Only for the tenant-isolation suite … every other test uses fakes" | `vitest.config.ts` lists 76 real-database suites | Informational; no check |
| DC-19 | `h-phase-close-out.md` Release row ("Plan the customer-facing effects first: D13 … trial lifecycle and soft limits") | Lists the customer-facing effects of the release | Omits N5.6: migration `20261002140000` adds `worker_settings.monthlyReportEnabled` **default `true`**, and no UI sets it, so every organization (fixtures included) gets a monthly report email and Slack message after the release | OD-13; C-08 records the value |
| DC-20 | `scripts/prod/h10-verify.sh` check 1; `h-phase-close-out.md` finding 1 | Compares each leaked key with the current value **of the same name** | D8's update consolidated `OPS_ALERT_SMTP_*` into `DEPLOYMENT_SMTP_*`, so a leaked ops SMTP password reused as `DEPLOYMENT_SMTP_PASSWORD` is not detected | C-15 adds a cross-name comparison |

### 2.4 Owner decisions needed (fill in)

| ID | Decision | Needed by | Your decision / date |
| --- | --- | --- | --- |
| OD-01 | **U2** (plan 09 §15.1): cleanup workflow after a rejected mass deletion, or written acceptance that a deletion abort blocks the integration until fixed at the source | N9.14-F1 (Beta) | |
| OD-02 | **D27**: which "new cases" are blocked after a trial ends (DC-11), and whether the documented gap stays | N6.4 closure, entitlement enforcement | |
| OD-03 | **Production billing provider** (D28 leaves it open) | N6.5, any production billing | |
| OD-04 | **Pre-merge verification policy** (Q9 deferred): CI runs only for `testing` | Branch rules; E-02 | |
| OD-06 | **H-8**: wait for upstream, or a lint-only TypeScript 6 pin | H-8, 7.10 | |
| OD-05 | Release go-ahead for N2–N10 (C-11), and separately for the N2.10 contract release (C-16) and the H-13 production backfill (C-13) | C-11, C-13, C-16 | |
| OD-07 | Where the 10 live customers' data is (DC-08), and whether the 11 `seed-org-*` fixture organizations stay in the production database (H-10 asks "no dev seed data in production") | H-1/D15 limitation, N4.7, H-10 | |
| OD-08 | Approve the benchmark method of plan 09 §6.10 (tiers, repetitions, environment) and, after D-01, the ceiling `C` | N9.7-F1 | |
| OD-09 | **N9.0-F1** (final review of the Rev 8 Markdown diff) and **N9.0-F2** (the copy change is already merged, DC-04: confirm or revert) | N9.0 follow-ups | |
| OD-10 | The proposed 24-hour expiry of override confirmations (plan 09 §15.2) | N9.11 copy, D-08 tests | |
| OD-11 | Accept C-14's drift-capture method as the "post-deploy replay" (DC-13) | N2.11 closure wording | |
| OD-12 | Whether H-10's "authorization audit current" needs a re-audit of the 28 routes added since the 71-route audit (DC-09) | H-10 | |
| OD-13 | Monthly reports go live with the release (`worker_settings.monthlyReportEnabled` defaults to `true`, DC-19): send from the first reconciliation tick, or hold them with the kill switch (a production SQL write, C-11's optional step) | C-11 | |

---

## 3. Items with adequate existing evidence (E7, no new check)

These are not re-run. Each relies on the evidence cited in its source; a later release may still need the deployment confirmation in C-12.

| Item | Evidence (source) |
| --- | --- |
| Phases 0–5, 6.1–6.7, 7.1, 7.2, 7.4, 7.5, 7.8, 7.9 | Roadmap historical phases (ticked with dates, tests named); 7.2 verified on the EC2 host by the owner 2026-09-29 |
| 7.3 backups and restore | Restore proven: production-backup runbook restore check (2026-10-02) and local restores of the 2026-10-02 backup (2026-10-05). **Gap:** the drill timing log was never committed → C-02 only |
| 7.7 / H-7 capacity | `docs/capacity-limits.md` (measured on dev hardware, stated as such). The dashboard's linear growth is a recorded limit with a proposed follow-up, not a task |
| H-1, H-4 | Closed 2026-09-30 by owner decision **with accepted limitations** (fixtures and one dev-sandbox tenant). Not re-run; see OD-07 |
| H-2, H-3, H-5, H-11, H-12 | Roadmap Production Hygiene entries and `h-phase-close-out.md` (H-11 production repair verified by the owner) |
| N1.0–N1.12, N1.14–N1.18 | 2026-10-01 host replay (N2.11): L1 0 differences / 5,440 records, L2 0 / 7,413; boundary allowlist empty; matrix smoke 4/4 |
| N2.1–N2.9 | Same replay; N2.6 browser comparison on fixtures (Rev 7) |
| N3.1–N3.5, N3.8, N3.9 | Restore-based backfill check and L1 replay 2026-10-05; named tests; browser checks |
| N4.1–N4.6, N5.1–N5.7, N6.1–N6.4, N6.6–N6.10 | Named test suites passing in the Rev 7 full run (2026-10-05). Deployment state is checked by A-04/C-12 |
| N9.1 | Spike result recorded in plan 09 §8.2 (8/8 criteria) |
| N10.0 | Documentation present (D33, plan 10, runbook) |
| D1–D33 | Decisions recorded; D27 has the open point OD-02 |
| Multi-worker leases (Appendix D invariant 11) | Real-DB suites `work-loop.db`, `fenced-prisma.db`, `organization-work-state.db`; in production since `7cb2b9b` (contains `b354b07`). The `apps/worker/scripts/bench` soak results were never recorded, but no document requires them |

Gated or not started, so **no validation is owed now**: N6.5 (needs a go-ahead and OD-03), N7 (Zoho Desk, go-ahead), N8-S1–S8 (triggers; C-15 collects the trigger measurements), N9.12-F1 (implementation work, not validation), N10-F1 (the contract migration is not written; after N10 is deployed, OD-05), the Launch Gate (superseded, kept unticked by rule), `plans/07-Phase-Status.md` outreach metrics (historical).

---

## 4. Phase A — Safe preflight (read-only)

### A-01 — Local repository and toolchain state

| | |
| --- | --- |
| Related | All later local checks; CLAUDE.md branch rules |
| Source | `package.json` (`engines.node >=22 <23`, `packageManager pnpm@10.33.0`); `CLAUDE.md` |
| Why | Commands below assume this commit and toolchain; uncommitted work must be preserved |
| Environment | E1 · your machine |
| Prerequisites | A checkout of `Yasser-Alnajjar/elapsed` |
| State | READ-ONLY |
| Depends on | – |
| Closes | Nothing alone; establishes the baseline commit for Phase B |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    origin/main sha=        node=        pnpm=        compose=        local modified files=
Deviations:
```

### A-02 — Remote and local branch inventory

| | |
| --- | --- |
| Related | N10.7, N9.0-F2, E-02; DC-02, DC-04 |
| Source | Roadmap N10.7 status; Branch rules "Testing branch"; `CLAUDE.md` |
| Why | The N10 tests and the `testing` sync state decide whether B-06 and E-02 can run |
| Environment | E1 |
| Prerequisites | A-01 |
| State | READ-ONLY (`git fetch` updates remote-tracking refs only) |
| Depends on | A-01 |
| Closes | Confirms or corrects DC-02 and DC-04 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    testing-n10 local? [ ] yes [ ] no   files present: _/8   testing behind main by: ___ commits   copy branch merged? [ ]
Deviations:
```

### A-03 — Production host inventory: deployed commit, compose and env files, application database

| | |
| --- | --- |
| Related | Status Board "What is deployed is not recorded"; DC-06, DC-17 |
| Source | Roadmap Status Board "Stage"; `docs/production-backup-runbook.md` "Where things are"; `docs/n2-replay-runbook.md` §0 [host] |
| Why | Every host command depends on the env file name and the application database; every replay depends on the deployed commit |
| Environment | E6 · PRODUCTION host |
| Prerequisites | SSH access |
| State | READ-ONLY. Prints key names, the database **name**, `NEXTAUTH_URL` and `POSTGRES_DB` (not secrets); never a password |
| Depends on | – |
| Closes | Records the deployed commit (`PROD_SHA`) needed by C-04 and the Status Board |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    PROD_SHA=            host modified files=     ENV_FILE=      APP_DB=      NEXTAUTH_URL=
             services:
Deviations:
```

### A-04 — Production migration state

| | |
| --- | --- |
| Related | Release of N2–N10; DC-05 |
| Source | `docs/h-phase-close-out.md` "Remaining owner actions" (Release row); `docs/production-backup-runbook.md` §1 |
| Why | Fixes the exact pending migration set that C-05 must reproduce on a restore |
| Environment | E6 · PRODUCTION (read-only SQL) |
| Prerequisites | A-03 |
| State | READ-ONLY (`ro_sql`) |
| Depends on | A-03 |
| Closes | Records the production schema state (Status Board) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host, APP_DB=
Evidence:    applied=   failed=   newest=
             pending (names):
Deviations:
```

### A-05 — Production health endpoints

| | |
| --- | --- |
| Related | Launch Gate "health-gated startup"; 7.1; `docs/deployment.md` "Health checks and observability" |
| Source | `apps/web/src/app/api/health/route.ts`; `apps/worker/Dockerfile` `HEALTHCHECK`; `docs/deployment.md` |
| Why | Baseline before any release; detects a stalled or degraded worker |
| Environment | E6 · PRODUCTION |
| Prerequisites | A-03 (`NEXTAUTH_URL`) |
| State | READ-ONLY |
| Depends on | A-03 |
| Closes | Baseline for C-12 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    web=   worker(s) status=   workState.leased=   overdue=   integrations.withErrors=
Deviations:
```

### A-06 — Production runtime configuration (names and set/empty only)

| | |
| --- | --- |
| Related | H-10 ("no development services/settings in production"), H-6, `data-retention-and-on-call.md` (`SENTRY_DSN`, `OPS_ALERT_*` "not verified"), BL-10, N9 Beta flag safety |
| Source | `docs/data-retention-and-on-call.md` "On-call note"; `docker-compose.yml`; `.env.example` |
| Why | Closes four "not verified" statements and confirms no private-host override reaches production |
| Environment | E6 · PRODUCTION |
| Prerequisites | A-03 |
| State | READ-ONLY. Prints `NAME=set` / `NAME=empty` only |
| Depends on | A-03 |
| Closes | `data-retention-and-on-call.md` "not verified" lines for Sentry and ops alerts |

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
Run by/date:
Where:       host
Evidence:    web:
             worker:
             worker replicas=
Deviations:
```

### A-07 — Scheduled backups: cron, retention, off-site copy, latest dump is the application database

| | |
| --- | --- |
| Related | 7.3, Launch Gate "Backups tested by a real restore", H-5 ("cron and off-site copy … not verified"), DC-06 |
| Source | `docs/deployment.md` "Scheduled backups"; `scripts/backup.sh` (`DB_NAME` defaults to `$POSTGRES_DB`); `docs/production-backup-runbook.md` trap 1 |
| Why | If cron runs `backup.sh` without `DB_NAME=elapsed_db`, every scheduled dump is the empty database and "succeeds" |
| Environment | E6 · PRODUCTION |
| Prerequisites | A-03 |
| State | READ-ONLY (`pg_restore --list` only reads the file). The cron line may contain a bucket name: redact it in the evidence |
| Depends on | A-03 |
| Closes | H-5 "not verified" backup line; part of 7.3 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    cron has DB_NAME? [ ]  off-site? [ ]  latest dump age=   size=   TABLE DATA=
Deviations:
```

### A-08 — Host log rotation and container log configuration

| | |
| --- | --- |
| Related | H-5 Decision 5; `data-retention-and-on-call.md` "Container logs … host `daemon.json` not verified" |
| Source | `docs/data-retention-and-on-call.md` "What is kept" |
| Why | Unbounded container logs can fill the disk; the document marks it unverified |
| Environment | E6 · PRODUCTION |
| Prerequisites | A-03 |
| State | READ-ONLY |
| Depends on | A-03 |
| Closes | The "not verified" container-log line |

```bash
cat /etc/docker/daemon.json 2>/dev/null || echo "no /etc/docker/daemon.json"
for n in web postgres nginx $(dc ps -q worker); do docker inspect --format '{{.Name}} {{json .HostConfig.LogConfig}}' "$n"; done
df -h / /var/lib/docker 2>/dev/null
```

**Pass:** you can record the driver and any `max-size`/`max-file`. Rotation absent is a **finding** for OD-style decision H-5/5, not a failure of this check; disk use above 80 % is a failure (stop and free space before C-01).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    log driver/options=          disk use=
Deviations:
```

### A-09 — Tenant and provider inventory (counts only)

| | |
| --- | --- |
| Related | H-1 limitation, D15, N4.7, H-10 manual line "no dev seed data", DC-08, N9/N10 deployment impact |
| Source | `scripts/prod/h1-provider-pairs.sql`; `scripts/prod/n47-plan-records.sql`; roadmap H-1 |
| Why | Establishes whether production holds the 10 customers, the fixtures, any Custom REST flags |
| Environment | E6 · PRODUCTION (read-only SQL) |
| Prerequisites | A-03 |
| State | READ-ONLY; prints counts only |
| Depends on | A-03 |
| Closes | Input to OD-07 and N4.7 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    fixture orgs=   non-fixture orgs=   integrations by provider/status=
             cases total/live=
Deviations:
```

### A-10 — Production host hardware profile

| | |
| --- | --- |
| Related | N9.7-F1 ("production-equivalent host"), N3.6, `capacity-limits.md` ("EC2 instance size is not recorded") |
| Source | Plan 09 §6.10 "Environment"; `docs/capacity-limits.md` "Where" |
| Why | D-01 and D-02 must run on hardware equal to or recorded against production |
| Environment | E6 · PRODUCTION |
| Prerequisites | – |
| State | READ-ONLY |
| Depends on | – |
| Closes | BL-02 |

```bash
nproc; lscpu | grep -E 'Model name|^CPU\(s\)'; free -h; df -h /
TOKEN=$(curl -sS -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') && \
  curl -sS -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type; echo
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'
```

**Pass:** instance type (or vCPU/RAM), disk and current container memory recorded.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    instance type=   vCPU=   RAM=   disk=   container mem (web/worker/postgres)=
Deviations:
```

### A-11 — Upstream lint blocker re-check (H-8)

| | |
| --- | --- |
| Related | H-8, 7.10 (lint half) |
| Source | Roadmap H-8 ("typescript-eslint 8.71.0 still declares typescript <6.1.0") |
| Why | Decides whether H-8 is still blocked |
| Environment | E1 (npm registry read) |
| Prerequisites | – |
| State | READ-ONLY |
| Depends on | – |
| Closes | H-8 only if support exists **and** a lint step is then added (implementation, out of scope) |

```bash
pnpm view typescript-eslint@latest version peerDependencies
grep -m1 '"typescript"' package.json
```

**Pass:** the result is recorded. If `peerDependencies.typescript` admits `7.x`, H-8 becomes implementable (tell me); otherwise it stays blocked (OD-06).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    typescript-eslint version=   peer typescript=
Deviations:
```

### CHECKPOINT A

Continue only if **all** hold: A-03 identified one env file, the application database and `PROD_SHA`; A-04 shows no failed migration; A-05 healthy; A-06 shows no private-host override in production; A-07 shows that a valid backup of the application database exists (or you have just taken one with C-01). Otherwise stop and send this file back.

```text
CHECKPOINT A:  [ ] passed — continue   [ ] stopped — reason:
```

---

## 5. Phase B — Isolated validation (your machine, disposable resources)

> **Branch policy (CLAUDE.md).** B-01–B-04 are static or migration checks allowed on `main`. **B-05–B-07 run test suites**: running them is a testing request, which `CLAUDE.md` places on the `testing` branch. Run them in a worktree of `testing-n10` (B-06) or of `testing` once you have decided to sync it with `main`; on a plain `main` worktree only if you explicitly authorize testing on `main`. **B-08–B-16 run the application locally against a disposable database and a local mock provider**; they write nothing outside your machine.

### B-01 — Prisma client generation and workspace type-check

| | |
| --- | --- |
| Related | DC-15; N9/N10 merge; roadmap "Task completion verification" |
| Source | `package.json` `type-check`; `.github/workflows/ci.yml` (generate, then type-check) |
| Why | No type-check of the merged HEAD (`0e48d28`) is recorded |
| Environment | E1 |
| Prerequisites | A-01; `pnpm install --frozen-lockfile` |
| State | Writes only `packages/db/generated/` (git-ignored) |
| Depends on | A-01 |
| Closes | Part of DC-15; prerequisite for every other B check |

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
Status:      [x] PASS (auditor pre-run, type-check part)   [ ] PASS (your run)   [ ] FAIL
Run by/date: auditor, 2026-10-09 UTC — commit 0e48d28 — `pnpm --filter @sla/db generate` OK, `pnpm type-check` exit 0, 0 "error TS" lines
             (without the generate step every package importing @sla/db fails: CI's order matters)
Your run:    <date>, commit <sha>, validate=  type-check exit=
Deviations:
```

### B-02 — Package, web and worker builds

| | |
| --- | --- |
| Related | DC-15; N10 verification policy ("web build on the phase branch"); release readiness |
| Source | `package.json` (`build`, `web:build`, `worker:build`); `.github/workflows/ci.yml` env block |
| Why | The merged HEAD has no recorded build |
| Environment | E1 |
| Prerequisites | B-01 |
| State | Writes build output only (`dist/`, `.next/`, git-ignored) |
| Depends on | B-01 |
| Closes | DC-15 (with B-01) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       commit
Evidence:    packages exit=   web exit=   worker exit=
Deviations:
```

### B-03 — All 68 migrations on an empty disposable database; no schema drift

| | |
| --- | --- |
| Related | N9.5 ("not applied to a database"), N10.1, DC-16; release migration safety |
| Source | Roadmap N9.5, N10.1; `package.json` `test:db:prepare` |
| Why | Proves the migration chain, including the `ALTER TYPE … ADD VALUE 'custom'` and the N10 seed, applies in order on PostgreSQL 16 and matches `schema.prisma` |
| Environment | E2 |
| Prerequisites | B-01; local Docker Postgres (§0.4) |
| State | Creates and later drops the disposable database `sla_validation_test` |
| Depends on | B-01 |
| Closes | N9.5 "not applied to a database" (empty-schema half) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       commit       db=sla_validation_test
Evidence:    migrate status=   diff exit=   migrations=   availability rows=   allowlist=
Deviations:
```

### B-04 — N2.10 contract artefacts still apply to the current schema

| | |
| --- | --- |
| Related | N2.10, N2.11 |
| Source | Roadmap N2.10 ("Re-verified 2026-10-05 … `schema.patch` still applies"); `packages/db/prisma/contract/20261001110000_…/README.md` |
| Why | Six migrations have landed since the 2026-10-05 re-verification |
| Environment | E1 + E2 |
| Prerequisites | B-03 |
| State | Part 1 read-only; part 2 writes `sla_validation_test` and a temporary worktree |
| Depends on | B-03 |
| Closes | Schema-level half of the N2.10 re-verification (the data half is C-09) |

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
Status:      [x] PASS (part 1, auditor pre-run 2026-10-09 at 0e48d28: `git apply --check` succeeded)   [ ] PASS (part 2)   [ ] FAIL
Run by/date:
Where:
Evidence:    contracted diff exit=    after rollback diff exit=
Deviations:
```

### B-05 — Tenant-scope classification and isolation for the N9/N10 models

| | |
| --- | --- |
| Related | N9.5 exit, plan 09 §8.6, H-10 "tenant isolation covers every model", DC-10 |
| Source | Plan 09 §8.6 ("the first test fails for any model without a classification"); roadmap N9.5 ("to be added on `testing`") |
| Why | Seven new models have no classification or isolation seeding |
| Environment | E2 |
| Prerequisites | **BLOCKED (BL-04)** until classification entries and isolation seeds for the 7 models are written on `testing` (ask for it). Running it before that only confirms the gap |
| State | Truncates every table of `sla_validation_test` (the suite refuses databases without `test` in the name) |
| Depends on | B-03 |
| Closes | N9.5 tenant-scope exit; H-10 "tenant isolation covers every model" (code half) |

```bash
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/sla_validation_test?schema=public"
npx vitest run apps/web/test/tenant-scope-classification.test.ts apps/web/test/tenant-isolation.test.ts
```

**Pass (after the prerequisite):** both files pass and the classification lists `IntegrationSyncRun`, `CustomProviderDraft`, `CustomProviderConfigVersion`, `GuardOverride`, `CustomActivationAudit`, `IntegrationAvailability` (platform-level, not tenant-scoped, must be declared as such) and `IntegrationBetaAllowlist`.
**Expected before the prerequisite:** a classification failure naming those models. Record it; it is the evidence for DC-10.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED (BL-04)   [ ] SKIPPED
Run by/date:
Where:       branch/worktree=         db=
Evidence:    files passed _/2; unclassified models listed=
Deviations:
```

### B-06 — N10 focused suites (plan 10 §10)

| | |
| --- | --- |
| Related | N10.7, N10 "Phase is done when" bullets 1–3, DC-02 |
| Source | Plan 10 §10 "As built"; roadmap N10.7 |
| Why | The recorded pass (8 suites / 72 tests) is not reproducible from the repository |
| Environment | E2 |
| Prerequisites | **BLOCKED (BL-03)** unless A-02 found all 8 files on your local `testing-n10`. Push it or tell me where it is |
| State | Truncates `sla_validation_test` |
| Depends on | B-03, A-02 |
| Closes | N10.7 (and with it N10's phase status, together with B-13–B-15) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED (BL-03)   [ ] SKIPPED
Run by/date:
Where:       testing-n10 sha=
Evidence:    files _/8   tests passed=   failed=   skipped=
Deviations:
```

### B-07 — Regression suites for the shared N9/N10 changes that already exist

| | |
| --- | --- |
| Related | N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15 (D32), N10.3; D13(b); plan 09 §10 "focused regression coverage" |
| Source | Roadmap N9.3/N9.8a/N9.9/N9.10/N9.13 ("Not run: … regression"); plan 09 §10, §13 "Regression" row |
| Why | Every shared-code task records its regression run as "for `testing`"; none is recorded |
| Environment | E2 |
| Prerequisites | B-03; a testing authorization (see the branch policy above) |
| State | Truncates `sla_validation_test` |
| Depends on | B-03 |
| Closes | The "regression" half of N9.14-F1 (1) for the existing suites; the D24 replay half is C-07 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       worktree/branch=      sha=
Evidence:    files passed _/_   known failures observed: providers [ ] admin-boundary [ ] supersession [ ]   other failures=
Deviations:
```

### B-08 — Local end-to-end stack (disposable database, web, worker, mock helpdesk)

| | |
| --- | --- |
| Related | N9.14-F1 (2) "an end-to-end run against a real or fixture API"; N9.11/N9.12 "not exercised"; N10 browser checks |
| Source | `packages/custom-ticket/dev/mock-helpdesk.mjs` and `mock-helpdesk-config.json`; `apps/web/scripts/seed-n9-test-orgs.ts`; `.env.example` (`CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS`) |
| Why | Shared setup for B-09–B-16 |
| Environment | E3 |
| Prerequisites | B-01; local Docker Postgres; `openssl` |
| State | Creates `sla_e2e_test`; writes `~/elapsed-validation/e2e.env` (throwaway secrets, mode 600, outside the repo) and `apps/web/.local/n9-test-credentials.txt` (git-ignored) |
| Depends on | B-01 |
| Closes | Setup only |

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

**Pass:** `curl -s localhost:3000/api/health` returns `{"status":"ok",...}`; `curl -s localhost:4010/__state | head -c 200` returns JSON; the three accounts are in `apps/web/.local/n9-test-credentials.txt`; you can sign in as `n9-owner-a@example.test` and see your organization (this proves web uses `sla_e2e_test`).
**On failure:** if sign-in fails with the seeded account, web is not using `sla_e2e_test` (check that `DATABASE_URL` was exported in that terminal); stop B-09+.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       commit
Evidence:    health=   mock state ok? [ ]   sign-in as owner A ok? [ ]
Deviations:
```

### B-09 — Custom REST end-to-end: draft, test, sample, preview, validate, activate, history import with partial runs

| | |
| --- | --- |
| Related | N9.11, N9.12, N9.6, N9.7, N9.8, N9.9, N9.14-F1 (2); plan 09 §4, §6.1, §6.12, §6.13; Q12, R3, R6 |
| Source | Roadmap N9.11 ("Not run: any route against a database or a real API"), N9.12 ("not exercised in a browser"), N9.6 ("`runCustomIngest` … has not been run") |
| Why | No custom route, activation, worker ingest or partial run has ever run |
| Environment | E3 |
| Prerequisites | B-08 running |
| State | Writes `sla_e2e_test` only |
| Depends on | B-08 |
| Closes | N9.14-F1 item (2) "end-to-end run against a fixture API" (together with B-10–B-16) |

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
mock '{"mode":"slow","delayMs":1500,"ticketCount":140}'
```

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       commit
Evidence:    test connection=   activate ok? [ ]   partial runs (count, reason, max took)=   counters during import=
             UI during import=        final cases/closed=     dup_cases=   dup_raw=   commitments by kind/status=   UI after=
Deviations:
```

### B-10 — Secret sentinel and redaction scan (plan 09 §8.4 items 1–2, 6)

| | |
| --- | --- |
| Related | N9.5 exit (§8.4), N9.3, Q16 |
| Source | Plan 09 §8.4 "Verification required before Beta" |
| Why | §8.4 verification has not been run |
| Environment | E3 |
| Prerequisites | B-09 PASS. The sentinel is the mock's key `mock-key-123` |
| State | READ-ONLY |
| Depends on | B-09 (the scan is repeated once more at the end of the next check, after its error paths write `lastSyncError` and sync history) |
| Closes | §8.4 items (1) and (2) for database, logs, sync history and API responses; items (3)–(7) stay with D-08 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    counts (7 rows)=        secret prefixes=        web.log=   worker.log=   API responses clean? [ ]   repeated after B-11? [ ]
Deviations:
```

### B-11 — Failure classes, recovery and freshness (plan 09 §6.12, §8.3, §8.5; R3)

| | |
| --- | --- |
| Related | N9.6, N9.9, N9.15; D13(b); N3.1 health columns |
| Source | Plan 09 §6.12 rule ("a real provider, authentication, transport or processing failure keeps the applicable failure policy"); §13 "Partial runs and failures" and "SSRF and the client" (redirects); `SyncRunOutcome` in `schema.prisma` |
| Why | The failure policy of the custom source has never run end to end |
| Environment | E3 |
| Prerequisites | B-09 PASS (import complete, mock `normal`) |
| State | Writes `sla_e2e_test`; changes the mock's mode |
| Depends on | B-09 |
| Closes | End-to-end evidence for N9.6/N9.9 failure handling (unit coverage stays with D-08) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    error500=          forbidden=          badjson=          redirect=          recovery=
Deviations:
```

### B-12 — Lifecycle guard abort, owner override, refused paths (plan 09 §6.4, §6.11; Q11, Q15, R1, R2, U1, U6)

| | |
| --- | --- |
| Related | N9.7 guards, N9.11 override routes, N9.12 `OverridePanel` |
| Source | Plan 09 §6.4 (lifecycle guard aborts only when `R ≥ 10` and `R > 0.25 × L`), §6.11 |
| Why | No guard or override has run against a database |
| Environment | E3 |
| Prerequisites | B-11 done (mock `normal`, 140 tickets, `L` = 140 live cases) |
| State | Writes `sla_e2e_test` |
| Depends on | B-11 |
| Closes | End-to-end evidence for the lifecycle guard and the customer override path |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    L=   N=   abort outcome/reason=   open before/after abort=   member refused? [ ]
             override row (guard/path/consumed/ttl)=         open after override=        support path status=
Deviations:
```

### B-13 — Availability during an in-flight request: allowlist removal aborts within about 5 s, data preserved, pause not resumed (plan 09 §8.7, plan 10 §5.4)

| | |
| --- | --- |
| Related | N10.3, N10.4, N9 Q5; N10 "Phase is done when" bullet 2 (Custom REST half) |
| Source | Plan 09 §8.7 "Turning the flag off"; `docs/integration-availability.md` "In-flight and queued work", "Procedure: Beta allowlist" |
| Why | The 5-second abort, the discarded response and the pause semantics have only been described |
| Environment | E3 |
| Prerequisites | B-12 done; operator account `n9-owner-b@example.test` |
| State | Writes `sla_e2e_test` |
| Depends on | B-12 |
| Closes | Custom REST half of N10's done-when "disable/re-enable … with no data changed" |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    abort outcome/reason=   finishedAt − audit = ___ s   diff=
             console re-add=   paused after re-add=   resume ingests? [ ]
Deviations:
```

### B-14 — Built-in provider disable/re-enable preserves data and shows "Paused by Elapsed" (N10 done-when)

| | |
| --- | --- |
| Related | N10.2, N10.5, N10.6; N10 "Phase is done when" bullets 2 and 4; D33 "Preservation" |
| Source | Plan 10 §6.1–§6.3; `docs/integration-availability.md` "What is never touched" |
| Why | The existing-provider half of N10's done-when has no evidence in the repository (N10.7's suites are on `testing-n10` only) |
| Environment | E3 |
| Prerequisites | B-08. **Stop the worker (terminal 3) before seeding and keep it stopped**: the fixture organization carries fake Zendesk and Jira tokens and a worker run would call the real provider APIs with them. The worker-side skip for built-in providers is covered by B-06 (`apps/worker/test/integration-availability.test.ts`); the Custom REST worker path by B-13 |
| State | Writes `sla_e2e_test` (fixture seed) |
| Depends on | B-08 (independent of B-09–B-13; run it after them so the worker can stay stopped) |
| Closes | Existing-provider half of N10 done-when bullet 2 and bullet 4 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    impact preview=   diff(0→1)=   diff(0→2)=   audit rows=   version/enabled=   card while disabled=   connect refused? [ ]
Deviations:
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

| | |
| --- | --- |
| Related | N9.8a, N9.11 activation/rollback, N9.12 `ImpactPanel` |
| Source | Roadmap N9.8a ("Not run: … the dry-run/confirm UI and the activation transaction"); plan 09 §5.5, §5.6 |
| Why | The first code that cancels `first_response`/`resolution` commitments has never run |
| Environment | E3 |
| Prerequisites | B-09 PASS (version 1, `slaMode: "full"`, commitments of all three kinds) |
| State | Writes `sla_e2e_test` |
| Depends on | B-09 (run after B-12/B-13 so their data is settled; resume polling first) |
| Closes | End-to-end evidence for N9.8a; U3 option (a) enforcement |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    dry-run counts=          after (by kind/status)=         finalized_md5 same? [ ]  evaluations same? [ ]
             audit row=          rollback to v1=          re-activate cancels=
Deviations:
```

### CHECKPOINT B

Required for the release (C-11): **B-01, B-02, B-03, B-07 PASS** (with only the three known failures in B-07). Required for any Custom REST Beta activation (N9.14-F1): additionally B-05, B-06, B-09–B-16 PASS and D-01, D-07, D-08, OD-01. A FAIL in B-10, B-12 or B-13 is a security or data-safety finding: stop and send the file back.

```text
CHECKPOINT B:  [ ] release prerequisites met   [ ] Beta prerequisites met   [ ] stopped — reason:
```

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

| | |
| --- | --- |
| Related | Release prerequisite; N2.10/N2.11; H-13; D24 replay input |
| Source | `docs/production-backup-runbook.md` §1–§3; `h-phase-close-out.md` Release row ("Back up first") |
| Why | Every C1 check runs on this dump; it is also the rollback point for C-11 |
| Environment | E6 · PRODUCTION (`pg_dump` reads; the dump file is written to the host disk) |
| Prerequisites | CHECKPOINT A; disk space (A-08) |
| State | READ-ONLY on the database; writes `backups/pre-validation-elapsed_db-<STAMP>.dump` (the `pre-` prefix is never pruned by cron) |
| Depends on | A-03, A-07, A-08 |
| Closes | Input for C-02–C-10 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    dump=                size=     TABLE DATA=    live cases=   integrations=   migrations=   DUMP_TS=
             off-host copy done? [ ]
Deviations:
```

### C-02 — Host restore drill with recorded timing (closes the 7.3 evidence gap)

| | |
| --- | --- |
| Related | 7.3, Launch Gate "Backups tested by a real restore", DC-07 |
| Source | `docs/deployment.md` "Test the restore"; `scripts/restore-drill.sh`; roadmap 7.3 ("add the line if it isn't committed yet") |
| Why | The recovery-time figure was never committed |
| Environment | E6 · PRODUCTION host, **scratch database `sla_restore_drill` only** (the script never touches `elapsed_db` and never stops web or worker) |
| Prerequisites | C-01; no other `sla_restore_drill` on the host that you still need (the script drops it at start and exit) |
| State | Creates and drops `sla_restore_drill` in the production Postgres instance (CPU and I/O for the restore duration); appends one line to `docs/restore-drills.log` in the host checkout |
| Depends on | C-01 |
| Closes | 7.3 evidence (after you commit the log line) |

```bash
COMPOSE_FILE=docker-compose.yml ENV_FILE="$ENV_FILE" scripts/restore-drill.sh "backups/pre-validation-elapsed_db-<STAMP>.dump"
tail -1 docs/restore-drills.log
```

**Pass:** the script prints `drill: … restore_seconds=<n> tables=<t> cases=<c>` with `cases` equal to C-01's live count (± rows written since the dump) and `tables` ≥ the `TABLE DATA` count. Copy the line into `docs/restore-drills.log` in your own checkout and commit it (E-03), then `git checkout -- docs/restore-drills.log` on the host if you do not want a modified host tree before C-11.
**On failure:** the script exits non-zero and drops the scratch database; record the message.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    drill line=
Deviations:
```

### C-03 — Restore the dump into `sla_restore_drill` on your machine

| | |
| --- | --- |
| Related | D24 replay gate; N2.11; N3–N10 shared changes |
| Source | `docs/n2-replay-runbook.md` §1; roadmap Rev 7 (2026-10-05 local restore of the production backup) |
| Why | The replay needs a restore that is not on the production host |
| Environment | E4 (restored production data on an isolated local database) |
| Prerequisites | C-01 copy; local Docker Postgres |
| State | Creates `sla_restore_drill` locally (customer data) |
| Depends on | C-01 |
| Closes | Input for C-04–C-10 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       local
Evidence:    cases=   integrations=   migrations=   newest=
Deviations:
```

### C-04 — L1 baseline with the deployed code

| | |
| --- | --- |
| Related | D24; N2.11 ("re-run this replay"); N9.3/N9.8a/N9.9/N9.10/N9.13/N9.15 "D24 replay"; N10.3 (worker path) |
| Source | `docs/n2-replay-runbook.md` §2; `packages/commitments/src/scripts/replay-capture.ts` (`--as-of`, `--out`; refuses databases other than `sla_restore_drill`) |
| Why | The baseline must come from the code production runs, before any migration |
| Environment | E4 |
| Prerequisites | C-03; `PROD_SHA` from A-03 |
| State | Read-only on `sla_restore_drill`; writes the capture file (customer data) |
| Depends on | C-03 |
| Closes | Input for C-07 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       local, base=PROD_SHA
Evidence:    records=   drift status=   drift breachedAt=   of commitments=   sha256=
Deviations:
```

### C-05 — Apply the pending migrations to the restore with `main`

| | |
| --- | --- |
| Related | Release N2–N10; DC-05; N9.5 ("not applied to a database"), N10.1 (fold of `customProviderEnabled`) |
| Source | `h-phase-close-out.md` Release row; `n2-replay-runbook.md` §3 |
| Why | The 6 N9/N10 migrations have never been applied on top of production data |
| Environment | E4 |
| Prerequisites | C-04 |
| State | Migrates `sla_restore_drill` |
| Depends on | C-04 |
| Closes | Migration-safety evidence for the release (replaces the 2026-10-05 evidence for 7 migrations, DC-05) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       local, main=MAIN_SHA
Evidence:    applied (names)=
             diff exit=
Deviations:
```

### C-06 — L2 normalization replay (twice)

| | |
| --- | --- |
| Related | D24; N2.3/N2.11; N9.15 projector change counts (D32: "replay must show 0 differences") |
| Source | `docs/n2-replay-runbook.md` §3; `apps/worker/scripts/l2-replay.ts` (`--out-dir`; refuses databases other than `sla_restore_drill`) |
| Why | The projector and adapters changed after the last L2 (2026-10-01) |
| Environment | E4 |
| Prerequisites | C-05 |
| State | Writes `sla_restore_drill` (re-normalization) and fingerprint files |
| Depends on | C-05 |
| Closes | L2 half of the D24 gate for the release |

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2a
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2b
```

**Pass (both runs):** `differences` 0, `recordFailures` 0, `normalizedEventIds` identical; record the record count (2026-10-01: 7,413). `INTEGRATION_TOKEN_ENCRYPTION_KEY=x` follows the runbook: normalization reads stored raw events, not credentials.
**On failure:** any difference stops the release; classify it under D24 (plan 01 §5) before anything else. Do not continue to C-11.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    run 1: records=   differences=   recordFailures=   ids identical=
             run 2: records=   differences=   recordFailures=   ids identical=
Deviations:
```

### C-07 — L1 replay: capture with `main`, compare with the baseline

| | |
| --- | --- |
| Related | D24 for every shared change since `PROD_SHA` (N3–N6 re-confirmed; N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15, N10.3) |
| Source | `docs/n2-replay-runbook.md` §3; `replay-compare.ts` (exit 1 on any unapproved class-A difference) |
| Why | No D24 replay covers the N9/N10 code (roadmap N9.8a, N9.9, N9.13: "Not run: the D24 replay") |
| Environment | E4 |
| Prerequisites | C-06 |
| State | Read-only on `sla_restore_drill`; writes the capture file |
| Depends on | C-06 |
| Closes | The D24 replay requirement of N9.3, N9.8a, N9.9, N9.10, N9.13, N9.15 for existing providers (N9.14-F1 item (1), replay half) |

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <DUMP_TS> --out ~/elapsed-validation/replay/after.jsonl
pnpm --filter @sla/commitments replay:compare -- ~/elapsed-validation/replay/baseline.jsonl ~/elapsed-validation/replay/after.jsonl; echo "compare exit=$?"
```

**Pass:** `compare exit=0`; the report shows **0 differences** (class A unapproved 0, class B 0) over the record count; C-class drift identical to C-04's.
**On failure:** exit 1 lists the differences: stop, keep the files, classify under D24. Do not deploy.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    records=   differences=   class A unapproved=   class B=   drift before/after=   compare exit=
Deviations:
```

### C-08 — Post-migration data assertions on the restore

| | |
| --- | --- |
| Related | N10.1 seed and fold, D33 "deploy changes no behavior", N9.8 (`slaSupport` null for existing providers), D32 (`lastDataChangedAt` no backfill), N5.6/N6.3 defaults |
| Source | Migration `20261009120000_n10_integration_availability`; D31/D32/D33; `schema.prisma` `WorkerSettings` defaults |
| Why | Proves the release leaves existing tenants' behavior and switches as documented, and exposes the defaults that do change behavior |
| Environment | E4 |
| Prerequisites | C-05 |
| State | READ-ONLY |
| Depends on | C-05 (can run before or after C-06/C-07) |
| Closes | N10.1 fold on production data; input to C-11's customer-impact list |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    availability rows=        flagged/allowlist=     slaSupport/dataChanged/custom=     runs/overrides=
             monthlyReportEnabled=   entitlementsEnforced=   grace=   intervals=   orgs with trial end=
Deviations:
```

### C-09 — N2.10 contract migration on the restore, through `prisma migrate deploy`, and rollback

| | |
| --- | --- |
| Related | N2.10, N2.11 |
| Source | Roadmap N2.10 (preconditions; "Re-verified 2026-10-05"); contract `README.md` ("move this directory into `prisma/migrations/`, apply `schema.patch` …") |
| Why | Six migrations landed since the last re-verification; the migration's timestamp (`20261001110000`) is older than migrations already applied, so Prisma's acceptance of it is proven only by doing it |
| Environment | E4 |
| Prerequisites | C-07 PASS (run after the replay; it alters the restore) |
| State | Alters, then restores, `sla_restore_drill`; creates a throwaway worktree |
| Depends on | C-07 |
| Closes | Re-verification of N2.10 on current `main` (release still needs C-16) |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    preconditions=        type-check=   deploy applied out-of-order? [ ]   contracted diff=   rollback diff=   md5 identical? [ ]
Deviations:
```

### C-10 — H-13 `breachedAt` backfill rehearsal on the restore

| | |
| --- | --- |
| Related | H-13; N1.2 class-C drift |
| Source | Roadmap H-13 ("To close (host)"); `packages/commitments/src/scripts/backfill-breached-at.ts` |
| Why | Gives the exact expected production result for C-13 on today's data. **The script has no scratch-database guard**: `DATABASE_URL` must point at the restore |
| Environment | E4 |
| Prerequisites | C-09 done (or C-07 if you skip C-09) |
| State | Writes `evaluations."breachedAt"` in `sla_restore_drill` |
| Depends on | C-07 |
| Closes | Rehearsal for H-13 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    run 1 rows=   skipped=   run 2 rows=   drift after=   compare exit=
Deviations:
```

### CHECKPOINT C1

Continue to the release only if: **C-01, C-03, C-04, C-05, C-06, C-07, C-08 PASS** and CHECKPOINT B's release prerequisites are met. A difference in C-06 or C-07 is a stop condition under D24 regardless of anything else.

```text
CHECKPOINT C1:  [ ] passed — release may be scheduled   [ ] stopped — reason:
```

### C-11 — GATED: release `main` (N2–N10) to production

| | |
| --- | --- |
| Related | Status Board "Up next (1)"; N2–N6 "built, not deployed"; N9 (Custom REST stays blocked by the rollout block); N10; DC-01 |
| Source | `h-phase-close-out.md` Release row; `docs/deployment.md` "Updating"; `docs/production-backup-runbook.md` "two traps" |
| Why | Most open items close only on the deployed code |
| Environment | E6 · **MODIFIES PRODUCTION** (builds images, runs the 13 migrations, restarts web and worker) |
| Prerequisites | CHECKPOINT C1; **OD-05** (your go-ahead); customer notices decided: D13 stale-source alert behavior, the monthly report default (OD-13, C-08), the new "Paused by Elapsed" states; a maintenance window |
| State | MODIFIES PRODUCTION |
| Depends on | CHECKPOINT C1 |
| Closes | "Deployed" state of N2–N10 (recorded by C-12) |

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
Status:      [ ] DONE   [ ] FAILED   [ ] NOT DONE (gate)
Run by/date:
Where:       host
Evidence:    pre-release dump=          HEAD=          migrate exit/log=          services=
             monthly reports held? [ ] yes [ ] no
Deviations:
```

### CHECKPOINT C2

```text
CHECKPOINT C2 (after C-11 and C-12):  [ ] production healthy on MAIN_SHA — continue   [ ] rolled back — reason:
```

### C-12 — Post-release verification (read-only)

| | |
| --- | --- |
| Related | Status Board (deployed commit), N2–N10 deployment, N10 "customers see Unavailable / Coming soon / Paused by Elapsed, never a false Disconnected" |
| Source | `h-phase-close-out.md` Release row ("record the deployed commit in the roadmap Status Board"); `docs/integration-availability.md` |
| Why | Confirms the release and produces the record the roadmap asks for |
| Environment | E6 · PRODUCTION (read-only) |
| Prerequisites | C-11 |
| State | READ-ONLY |
| Depends on | C-11 |
| Closes | "Not deployed" notes on N2–N10 (E-03 records the commit) |

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
**On failure:** a status change or a burst of `work_failed` after the release is an incident: decide on rollback (C-11 *On failure*).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host, HEAD=
Evidence:    applied=   newest=   availability=   status counts same as A-09? [ ]   health=   failures/finished (30 min)=   UI checks? [ ]
Deviations:
```

### C-13 — GATED: H-13 production backfill

| | |
| --- | --- |
| Related | H-13 |
| Source | Roadmap H-13 "To close (host)"; `h-phase-close-out.md` H-13 row |
| Why | The 9 `breachedAt` NULL rows make the dashboard's breaches-over-time fall back to `dueAt` for one organization |
| Environment | E6 · **MODIFIES PRODUCTION DATA** (`UPDATE evaluations set "breachedAt"` for the rows C-10 identified; idempotent) |
| Prerequisites | C-10 PASS (expected count known); C-12 PASS; OD-05; a fresh backup taken right before |
| State | MODIFIES PRODUCTION |
| Depends on | C-10, C-12 |
| Closes | H-13 (with C-14) |

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
Status:      [ ] DONE   [ ] FAILED   [ ] NOT DONE (gate)
Run by/date:
Where:       host
Evidence:    backup=      run 1 rows=   skipped=   run 2 rows=
Deviations:
```

### C-14 — Post-release drift capture (the "re-run the replay" step, DC-13)

| | |
| --- | --- |
| Related | N2.11 ("After deploying, re-run the replay"); H-13 ("Then a replay capture should report drift 0 / 0"); D24 |
| Source | `h-phase-close-out.md` Release and H-13 rows |
| Why | Shows the deployed code recomputes every stored status and breach instant identically on production data |
| Environment | E4 (a restore of a post-release production backup on your machine) |
| Prerequisites | C-12 (and C-13 if done); OD-11 accepts this method |
| State | Read-only on production (`pg_dump`); writes a local restore |
| Depends on | C-12 |
| Closes | N2.11's post-release replay wording; H-13's drift criterion |

Take a backup as in C-01 (label `post-release`), copy it off the host, restore it as in C-03, then:

```bash
cd ~/elapsed-validation/main
DATABASE_URL="$DRILL_URL" pnpm --filter @sla/commitments replay:capture -- --as-of <POST_DUMP_TS> --out ~/elapsed-validation/replay/post-release.jsonl
DATABASE_URL="$DRILL_URL" INTEGRATION_TOKEN_ENCRYPTION_KEY=x pnpm --filter @sla/worker replay:l2 -- --out-dir ~/elapsed-validation/replay/l2-post
```

**Pass:** drift line **0 status, 0 breachedAt** (or 0 status and C-04's `breachedAt` count if C-13 was not run); L2 0 differences, 0 record failures. When done: `ldc exec -T postgres dropdb -U user sla_restore_drill` and delete the local dumps you no longer need.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:
Evidence:    POST_DUMP_TS=   drift=   L2 differences/failures=
Deviations:
```

### C-15 — H-10 production security verification (corrected for the host's database)

| | |
| --- | --- |
| Related | H-10; Launch Gate security items; `data-retention-and-on-call.md` ("whether `pnpm db:encrypt-tokens` has been run on production is not verified"); DC-06 |
| Source | `scripts/prod/h10-verify.sh`; `h-phase-close-out.md` "H-10 — production security verification" |
| Why | The script's token check (3) queries `$POSTGRES_DB`, the empty database on this host, so it can pass vacuously; checks 1, 2 and 4 are valid |
| Environment | E6 · PRODUCTION (read-only; the script compares hashes and prints no value) |
| Prerequisites | A-03; a non-shallow clone on the host (`git rev-parse --is-shallow-repository` prints `false`) for check 1; `shasum` installed |
| State | READ-ONLY |
| Depends on | A-03 (run after C-12 so it checks the deployed stack) |
| Closes | H-10's script part and the encryption "not verified" line; the third-party rotation is D-05 |

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
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    FAIL lines=   PASS lines=   plaintext access/refresh/slack=   NODE_ENV=
             MANUAL answers:
Deviations:
```

### C-16 — GATED: N2.10 contract release

| | |
| --- | --- |
| Related | N2.10, N2.11 (the phase closes with it) |
| Source | Roadmap N2.10 ("ship it as its own release, after a fresh backup"); contract `README.md` |
| Why | Drops the legacy identity columns and the source-less Case key |
| Environment | E6 · **MODIFIES PRODUCTION** (and a code change through a reviewed PR) |
| Prerequisites | C-09 PASS; C-12 PASS and at least one production release on the N1/N2 dual-write code (C-11 is that release); C-14 PASS; OD-05 for this release specifically |
| State | MODIFIES PRODUCTION |
| Depends on | C-09, C-14 |
| Closes | N2.10, then N2.11 |

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

| | |
| --- | --- |
| Related | N4.7; N4 "Phase is done when: the 10 tenants' records are filled in"; Validation Metrics "Commercial" |
| Source | Roadmap N4.7; `scripts/prod/n47-plan-records.sql` (its header uses `$POSTGRES_DB`: use `ro_sql`, DC-06) |
| Why | The tooling exists; the data is not entered |
| Environment | E6 · PRODUCTION: your data entry in `/admin/tenants/[organizationId]` **modifies production data through the audited UI**; this check itself is READ-ONLY |
| Prerequisites | C-12; OD-07 (which organizations are the real customers) |
| State | READ-ONLY |
| Depends on | C-12 |
| Closes | N4.7 and N4 (counts pasted to the Status Board in E-03) |

```bash
ro_sql < scripts/prod/n47-plan-records.sql
```

**Pass:** in table 2, `plan_not_recorded = 0`; `trial_without_end_date` and `paying_without_billing_reference` equal what you intended; table 1 pasted (counts only).

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [ ] BLOCKED   [ ] SKIPPED
Run by/date:
Where:       host
Evidence:    table 1=
             table 2=
Deviations:
```

### C-18 — Production measurements for N3.7, N8 triggers and the Validation Metrics (read-only, weekly)

| | |
| --- | --- |
| Related | N3.7 (circuit breaker "only if production measurements justify it", D22); N8-S1–S4 triggers; roadmap "Validation Metrics" (reliability rows, weekly active orgs) |
| Source | `h-phase-close-out.md` N3.6/N3.7 row ("read `/admin/monitoring` … for a few weeks, then record 'not needed, measured at X ms'"); plan 08 trigger table |
| Why | N3.7 and the N8 items are decided only by production measurements; none is recorded |
| Environment | E6 · PRODUCTION (read-only) |
| Prerequisites | C-12 (the columns exist only after the release) |
| State | READ-ONLY |
| Depends on | C-12; repeat weekly for at least 3 weeks |
| Closes | N3.7 decision input; N8 trigger status; Validation Metrics baseline |

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
Week 1 (date):  per-provider p95/max/streaks=          healthy=   tick ratio=   overdue=   alert failure rate=   WAO=
Week 2 (date):
Week 3 (date):
Conclusion for N3.7 / N8:
```

---

## 7. Phase D — External dependencies and missing infrastructure

Each item starts when its prerequisite exists; none blocks the release (C-11) except where stated. Where no command exists in the repository, none is invented: the prerequisite is listed instead.

### D-01 — N9.7-F1: plan 09 §6.10 benchmark gate that fixes the Custom REST live-case ceiling

| | |
| --- | --- |
| Related | N9.7 exit criterion, N9.7-F1, N9.14-F1 (3), Q13, R4; OD-08 |
| Source | Plan 09 §6.9, §6.10; roadmap N9.7-F1 |
| Why | No ceiling is validated; Beta enablement is blocked until a written report fixes `C` |
| Environment | E4 · a host matching A-10, a fresh database whose name contains `bench` |
| Prerequisites | **BLOCKED.** (1) BL-01: a §6.10 harness does not exist (`packages/custom-ticket/bench/` is absent; `apps/worker/scripts/bench/run.ts` measures multi-worker scheduling with a fake Linear, and `pnpm db:seed:perf-baseline` inserts `NormalizedEvent` rows directly, which §6.10 forbids). It must drive synthetic custom-shaped data through the real `deriveBatch` and projector, on `testing`. (2) BL-02/A-10 host profile. (3) OD-08 method approval. (4) To apply a ceiling other than 5,000 in production, BL-10 (`CUSTOM_PROVIDER_LIVE_CASE_CEILING` is not passed by `docker-compose.yml`) |
| State | Writes only the `*bench*` database |
| Depends on | A-10, OD-08 |
| Closes | N9.7-F1; the ceiling `C`; N9.14-F1 item (3) |

**Commands:** none exist yet. When the harness exists, it must report per tier (1,000 / 5,000 / 10,000 / 20,000 live cases) and per pass (full; incremental at 1 %, 5 %, 25 %; first activation dry-run; guard abort), ≥ 5 runs per cell, with `PERF_METRICS=1` scopes comparable to `docs/capacity-limits.md`.
**Pass (plan 09 §6.10):** per tier, p95 organization sweep ≤ **30 s** and p95 organization-lock hold ≤ **10 s** including custom normalization and projection; memory inside the worker limit with the margin stated; query count and lock time no worse than linear (slope reported); the guard-abort pass writes nothing. `C` = largest passing tier; if the incremental design is used, correctness criteria 1–7 of §6.10 also pass. A failing tier is never answered by raising a limit.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-01, BL-02, OD-08)   [ ] SKIPPED
Run by/date:
Where:       host spec=          db=
Evidence:    tier | pass | sweep p95 | lock p95 | peak RSS | queries/case | notes
             1,000  |      |           |          |          |              |
             5,000  |      |           |          |          |              |
             10,000 |      |           |          |          |              |
             20,000 |      |           |          |          |              |
             C = ______   report location=
Deviations:
```

### D-02 — N3.6: production-scale two-hour outage drill

| | |
| --- | --- |
| Related | N3.6, N3 "Phase is done when" (other tenants' tick time within ±10 %; no stale-source alert without D13 treatment), D13, D22 |
| Source | Roadmap N3.6; plan 03; `h-phase-close-out.md` N3.6/N3.7 row ("Do not pause a real customer's polling to simulate an outage") |
| Why | Only unit/real-DB drills exist (`cycle.test.ts`, `stale-source-notifications.test.ts`) |
| Environment | E4 · staging host matching A-10, with a production-scale dataset whose provider calls are all faked |
| Prerequisites | **BLOCKED (BL-05).** No outage-injection harness: `apps/worker/scripts/bench/fake-linear-preload.mjs` supports latency only (`BENCH_PROVIDER_LATENCY_MS`), not a per-tenant hang or error for two hours. Needs: a staging host, a dataset (seeded, or a restore with the production encryption keys absent so no real provider can be called), and a per-tenant failure mode. Never on production |
| State | Staging only |
| Depends on | A-10 |
| Closes | N3.6, then N3's phase status (with N3.7 from C-18) |

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

| | |
| --- | --- |
| Related | N5.8, H-9, historical 6.8; N5 "Phase is done when: all four pairs onboard in local dev, and Zendesk + Jira live"; Launch Gate product item 1 |
| Source | `h-phase-close-out.md` "H-9 — live onboarding walkthrough" and Remaining owner actions (N5.8 / H-9 row) |
| Why | Only stubbed walkthroughs exist (N1.16); no real OAuth round trip |
| Environment | E5 · your local stack plus real sandbox accounts (no production) |
| Prerequisites | **BLOCKED (BL-06):** Zendesk sandbox admin login and OAuth client (required); Intercom and Linear sandbox workspaces with OAuth apps; a Jira test site |
| State | Local only; reads the sandbox accounts |
| Depends on | B-02 (a building stack) |
| Closes | N5.8, H-9, 6.8 (and N5's phase status) |

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

| | |
| --- | --- |
| Related | N1.13 (`[~]`); Review Trigger "link coverage < 60 %" |
| Source | Roadmap N1.13 ("Not done, environment limit (1)"); `h-phase-close-out.md` N1.13 row |
| Why | Only the URL shape this repository builds is recognized; Intercom + Linear customers may see low link coverage |
| Environment | E5 · a real Intercom workspace linked to Linear |
| Prerequisites | **BLOCKED (BL-06)** |
| State | Reads the sandbox |
| Depends on | – |
| Closes | N1.13's capture half. Its L2 half ("Zendesk tenants' `certain` link counts and legs identical") is closed by **C-06** |

Link one Intercom conversation to a Linear issue with Intercom's Linear integration; in Linear, open the issue's attachments and copy the stored URL; redact the workspace and ids to placeholders, keeping the host and path shape.
**Pass:** the shape is recorded here. Adding it as a fixture in `recognizeIntercomConversationUrl`'s tests is implementation work that follows.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-06)   [ ] SKIPPED
Evidence:    URL shape (redacted)=
```

### D-05 — H-10: replace the leaked third-party credentials and record the rotation

| | |
| --- | --- |
| Related | H-10; Launch Gate "Every leaked secret has been rotated" |
| Source | `h-phase-close-out.md` "Findings from this pass" 1; `docs/deployment.md` "Rotating secrets" (rotation log; "The script can't rotate third-party credentials") |
| Why | The leaked `.env.prod` held `OPS_ALERT_SMTP_PASSWORD` (+ user/host) and `SENTRY_DSN`; the 2026-09-19 rotation covered four other secrets only. Since D8's update the ops alert mail goes through `DEPLOYMENT_SMTP_*`, so a leaked ops SMTP password may now live on under that name (C-15's extra comparison checks it) |
| Environment | E6 · **MODIFIES PRODUCTION** configuration (restart) + provider consoles |
| Prerequisites | **BLOCKED (BL-08)** on your provider accounts; a backup is not needed (no data change) |
| State | MODIFIES PRODUCTION |
| Depends on | C-15 |
| Closes | H-10 (with C-15 PASS, OD-07, OD-12) |

Revoke and replace at the providers (SMTP account password or app password; Sentry DSN key), edit the env file on the host yourself, then `dc up -d web worker`, re-run **C-15**, and add a row to the rotation log table in `docs/deployment.md` (date, reason, scope, method; no values).
**Pass:** C-15 re-run shows no `FAIL`, the extra comparison prints `DIFFERENT` (or the old key is unset), A-05 healthy after the restart, rotation-log row committed.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-08)   [ ] SKIPPED
Evidence:    revoked at providers (date)=   C-15 re-run=   rotation log row committed? [ ]
```

### D-06 — H-6: Sentry source maps on the host (gated rebuild)

| | |
| --- | --- |
| Related | H-6 (was 7.6); Launch Gate "Sentry" |
| Source | `h-phase-close-out.md` "H-6 — Sentry source maps"; `docs/deployment.md` "Sentry source maps" |
| Why | Code side done; never verified |
| Environment | E5 + E6 · **MODIFIES PRODUCTION** (rebuilds and restarts `web`) |
| Prerequisites | **BLOCKED (BL-07)**; D-05's replacement `SENTRY_DSN` first; you edit the env file yourself (never paste values here) |
| State | MODIFIES PRODUCTION |
| Depends on | D-05, C-12 |
| Closes | H-6 |

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

| | |
| --- | --- |
| Related | N9.14, N9.14-F1 item (5); plan 09 Appendix A |
| Source | `implementation-plans/n9-legal-review.md`; roadmap N9.14 ("Terms/Privacy NOT edited") |
| Why | Beta enablement requires it |
| Environment | External (legal); listed under E5 in §2.1 |
| Prerequisites | **BLOCKED (BL-09)** |
| State | – |
| Depends on | – |
| Closes | N9.14-F1 item (5) |

**Pass:** a written legal decision on each draft clause (approved / changed / rejected). Editing Terms and Privacy is a separate change afterwards.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-09)   [ ] SKIPPED
Evidence:    reviewer/date=   outcome per clause=
```

### D-08 — N9 focused tests of plan 09 §13 and §8.4 items 3–7

| | |
| --- | --- |
| Related | N9.5 exit, N9.2 (SSRF), N9.4 (mapping), N9.6–N9.9, N9.11, N9.13, N9.15; N9.14-F1 item (1) |
| Source | Plan 09 §13 "Focused coverage that must exist before Beta enablement"; §8.4 "Verification required before Beta" |
| Why | `packages/custom-ticket/test` has 2 files; `packages/safe-http` has no `test/` directory; §13's areas are otherwise untested |
| Environment | E2 (on `testing`) |
| Prerequisites | **BLOCKED (BL-04):** the tests must be written on `testing` when you ask for it |
| State | Disposable test database |
| Depends on | B-03 |
| Closes | N9.5 exit (§8.4 items 3–6; item 7, the rotation limitation in the deployment documentation, is **already satisfied**: `docs/deployment.md`, `INTEGRATION_TOKEN_ENCRYPTION_KEY` row), N9.14-F1 item (1) test half |

**Pass:** every §13 row has at least one test and all pass, in particular: §8.4 (3) unset/wrong key fails closed with a generic message; (4) the strict helper rejects an unprefixed value and each malformed form with one generic outcome; (5) a ciphertext moved to another organization, integration or field is rejected; (6) existing providers' `decryptToken` tests pass unmodified; the SSRF matrix; every boundary row of the §6.4 guards; the Q14/R5 rollback rows.

```text
RESULT
Status:      [ ] PASS   [ ] FAIL   [x] BLOCKED (BL-04)   [ ] SKIPPED
Evidence:    test files=   §13 rows covered _/22   failures=
```

---

## 8. Phase E — Final acceptance

### E-01 — Evidence review and file integrity

| | |
| --- | --- |
| Related | Every check; roadmap "Task completion verification" |
| Source | Roadmap "How This Roadmap Works" §3 and "Task completion verification" |
| Why | A task is ticked only when its own criteria pass, not when a command exits 0 |
| Environment | E1 |
| Prerequisites | Every other check has a filled RESULT |
| State | READ-ONLY |
| Depends on | all |
| Closes | Hand-over of this file |

```bash
f=docs/validation/server-validation-master.md
grep -oE '^### [A-E]-[0-9]+' "$f" | sort | uniq -d                 # duplicate check IDs: must print nothing
grep -cE '^Status: +\[ \] PASS' "$f"                                 # unfilled status lines remaining
git diff --check
```

**Pass:** no duplicate IDs; every RESULT has one box ticked; every FAIL has its *On failure* steps recorded; every BLOCKED names its prerequisite; for each item in §9 you can point at the checks that meet its "Evidence needed".

```text
RESULT
Status:      [ ] PASS   [ ] FAIL
Evidence:    duplicates=   unfilled=   FAIL list=   BLOCKED list=
```

### E-02 — Full regression suite on `testing` after you sync it with `main`

| | |
| --- | --- |
| Related | DC-15; CLAUDE.md "On `testing`"; roadmap Rev 7 baseline (258 files / 2,766 tests) |
| Source | `CLAUDE.md` ("`testing` is based on `main` … only synchronize when explicitly asked"); `.github/workflows/ci.yml` (golden-scenario step) |
| Why | No full run of the merged N9/N10 code exists; CI runs only on `testing`, which is 35 commits behind `main` |
| Environment | E2 |
| Prerequisites | **Your explicit decision to merge `main` into `testing`** (OD-04); B-03 |
| State | Merges into a local `testing` worktree (push is your decision); truncates `sla_validation_test` |
| Depends on | B-07, B-06 |
| Closes | DC-15; the regression half of N9.14-F1 (1); "Remote CI is green" for the next phase PR once pushed |

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

| | |
| --- | --- |
| Related | Every row of §9 |
| Source | Roadmap "How This Roadmap Works" (Complete, Close the phase, Continue) |
| Environment | E1 (documentation only) |
| State | Edits documentation only |
| Depends on | E-01 |
| Closes | The documentation state of every item whose evidence passed |

For each row of §9 whose evidence passed, update the listed documents in one documentation change: tick or annotate the roadmap tasks with the date and check IDs, update the Status Board (deployed commit from C-12, N4.7 counts from C-17), correct every DC row that the evidence settles, and add a changelog entry. Rows whose evidence failed or is blocked keep their current status with the exact blocker. I make these edits when you send the completed file back; nothing in this step runs a command.

```text
RESULT
Status:      [ ] DONE   [ ] PARTIAL (rows left open listed below)
Evidence:    documents changed=          rows closed=          rows left open=
```

---

## 9. Documentation closure map

| Item | Current state | Evidence needed to close | Documents to update on success |
| --- | --- | --- | --- |
| Status Board, phase overview, N9/N10 status lines (DC-01, DC-15, DC-16) | Stale: says N10 unpushed; deployed state unknown | A-03, A-04, B-01, B-02, C-12 | `ROADMAP_Product.md` Status Board, Phase overview, N9 and N10 status lines, Changelog |
| Release of N2–N10 ("built, not deployed") | Not deployed (last recorded production `7cb2b9b`) | C-01–C-08 PASS, C-11 DONE, C-12 PASS | Roadmap Status Board ("Stage", deployed commit and date); `h-phase-close-out.md` Release row (13 migrations, DC-05) |
| 7.3 restore drill timing | Ticked; log missing (DC-07) | C-02 | Commit `docs/restore-drills.log`; roadmap 7.3 note |
| H-5 "not verified" lines | Unverified on host | A-06, A-07, A-08, C-15 | `docs/data-retention-and-on-call.md` (Sentry, ops alerts, cron/off-site, log rotation, `db:encrypt-tokens`) |
| H-6 | Open | D-06 (after D-05) | Roadmap H-6; `h-phase-close-out.md` H-6 |
| H-8 | Blocked upstream | A-11 + OD-06 (then a lint step, implementation) | Roadmap H-8 |
| H-10 | Open | C-15 PASS, D-05 PASS, OD-07, OD-12 | Roadmap H-10; `docs/deployment.md` rotation log; `h-phase-close-out.md` H-10 |
| H-13 | Open (host run) | C-10, C-13, C-14 | Roadmap H-13 (closed with counts); `h-phase-close-out.md` H-13 row |
| N1.13 | `[~]` | D-04 (capture) + C-06 (L2) | Roadmap N1.13; `h-phase-close-out.md` N1.13 row |
| N2.10 | `[~]`, held out | C-09, then C-16 | Roadmap N2.10; contract `README.md` (moved); `h-phase-close-out.md` N2.10 row |
| N2.11 / N2 phase | `[~]` | N2.10 closed + C-14 (OD-11) | Roadmap N2.11, N2 status, phase overview |
| N3.6 | `[~]` | D-02 | Roadmap N3.6 |
| N3.7 / N3 phase | Open, evidence-gated | C-18 (≥ 3 weeks) + your record "not needed, measured at X" or a trigger | Roadmap N3.7, N3 status |
| N4.7 / N4 phase | Open (data) | OD-07, C-17 | Roadmap N4.7 (counts), N4 status, Status Board |
| N5.8 / H-9 / 6.8 / N5 phase | Open | D-03 | Roadmap N5.8, H-9, 6.8 note; `h-phase-close-out.md` H-9 |
| N6.4 (D27 gap) | Done with a documented gap | OD-02 | Roadmap D27, N6.4; plan 06 |
| N6.5 | Not started (gated) | OD-03 + go-ahead | – |
| N9.0-F1 / F2 / F3 | Open | OD-09 (F1, F2), OD-01 (F3) | Roadmap N9.0 follow-ups (DC-04) |
| N9.5 exit (§8.4) | Not run | B-03, B-05, B-10, D-08 | Roadmap N9.5 |
| N9.6 / N9.7 / N9.9 / N9.15 behavior | Not run against a database | B-09, B-11, B-12, B-13 | Roadmap N9.6, N9.7, N9.9, N9.15 notes |
| N9.8a / N9.9 / N9.10 / N9.13 / N9.15 D24 + regression | "Not run" | C-06, C-07 (replay); B-07, B-16 (regression/flow) | Roadmap N9.8a, N9.9, N9.10, N9.13, N9.15 |
| N9.11 / N9.12 | "Not exercised" | B-09–B-16 | Roadmap N9.11, N9.12 |
| N9.7-F1 | Open | D-01 + OD-08 (+ BL-10 to apply `C`) | Roadmap N9.7, N9.7-F1 (harness path, DC-03); plan 09 §6.9–§6.10; `docs/capacity-limits.md` |
| N9.14-F1 (Beta) | Blocked, enforced in code | Items (1) B-03, B-05, B-07, B-10, C-05–C-07, D-08; (2) B-09–B-16; (3) D-01; (4) OD-01; (5) D-07 — then a reviewed code change lifting the block in `packages/db/src/integration-catalog.ts` | Roadmap N9.14-F1; `docs/integration-availability.md` "Rollout block"; public docs and `plans.ts` copy (separate change) |
| N10.7 | Open (tests not in the repository, DC-02) | Push `testing-n10` + B-06 | Roadmap N10.7; plan 10 §10 |
| N10 phase done-when | 6/7 | B-06, B-13, B-14, B-15, C-12 | Roadmap N10 status → ✅ with the merge commit `0e48d28`; phase overview |
| N10-F1 | Not written | After C-12, OD-05; the contract migration does not exist yet (implementation) | Roadmap N10-F1 |
| Runbook commands (DC-06, DC-17) | Inconsistent env file / database names | A-03 | `docs/deployment.md`, `deployment-runbook.md`, `h-phase-close-out.md`, `n2-replay-runbook.md`; `scripts/prod/h10-verify.sh` check 3 and `n47-plan-records.sql` header (script changes: your approval) |
| 10 live customers (DC-08) | Unlocated in the queried database | A-09 + OD-07 | Roadmap Status Board, H-1 limitation |
| Monthly report default (DC-19) | Turns on with the release | C-08 + OD-13 | Roadmap N5.6 note; release notes in `h-phase-close-out.md` |
| Launch Gate | Superseded, never ticked | none (by rule, not ticked retroactively) | – |

---

## 10. Check index (IDs, dependencies, state)

| ID | Title | Env | Depends on | State |
| --- | --- | --- | --- | --- |
| A-01 | Local repository and toolchain | E1 | – | read-only |
| A-02 | Branch inventory | E1 | A-01 | read-only |
| A-03 | Host inventory | E6 | – | read-only |
| A-04 | Production migration state | E6 | A-03 | read-only |
| A-05 | Health endpoints | E6 | A-03 | read-only |
| A-06 | Runtime configuration names | E6 | A-03 | read-only |
| A-07 | Scheduled backups | E6 | A-03 | read-only |
| A-08 | Log rotation, disk | E6 | A-03 | read-only |
| A-09 | Tenant/provider counts | E6 | A-03 | read-only |
| A-10 | Host hardware | E6 | – | read-only |
| A-11 | Upstream lint support | E1 | – | read-only |
| B-01 | Generate + type-check | E1 | A-01 | local build output |
| B-02 | Builds | E1 | B-01 | local build output |
| B-03 | Migrations on empty DB, drift | E2 | B-01 | disposable DB |
| B-04 | N2.10 artefacts on current schema | E2 | B-03 | disposable DB |
| B-05 | Tenant-scope classification | E2 | B-03 | disposable DB · BLOCKED |
| B-06 | N10 focused suites | E2 | B-03, A-02 | disposable DB · BLOCKED |
| B-07 | Existing regression suites | E2 | B-03 | disposable DB |
| B-08 | Local E2E stack | E3 | B-01 | disposable DB |
| B-09 | Custom REST E2E + partial import | E3 | B-08 | disposable DB |
| B-10 | Secret sentinel scan | E3 | B-09 (repeat after B-11) | read-only |
| B-11 | Failure classes | E3 | B-09 | disposable DB |
| B-12 | Lifecycle guard + override | E3 | B-11 | disposable DB |
| B-13 | In-flight availability abort | E3 | B-12 | disposable DB |
| B-14 | Built-in provider disable/re-enable | E3 | B-08 (after B-13) | disposable DB |
| B-15 | Rollout block | E3 | B-08 | disposable DB |
| B-16 | Unsupported kinds, rollback guard | E3 | B-09 (after B-13) | disposable DB |
| C-01 | Production backup | E6 | A-03, A-07, A-08 | read-only DB; file on host |
| C-02 | Host restore drill | E6 | C-01 | scratch DB on host |
| C-03 | Local restore | E4 | C-01 | local restore |
| C-04 | L1 baseline (deployed code) | E4 | C-03 | read-only |
| C-05 | Migrate restore with `main` | E4 | C-04 | local restore |
| C-06 | L2 replay ×2 | E4 | C-05 | local restore |
| C-07 | L1 compare | E4 | C-06 | read-only |
| C-08 | Post-migration assertions | E4 | C-05 | read-only |
| C-09 | N2.10 apply + rollback on restore | E4 | C-07 | local restore |
| C-10 | H-13 rehearsal | E4 | C-07 (after C-09) | local restore |
| C-11 | Release (GATED) | E6 | CHECKPOINT C1, OD-05 | **modifies production** |
| C-12 | Post-release verification | E6 | C-11 | read-only |
| C-13 | H-13 production backfill (GATED) | E6 | C-10, C-12, OD-05 | **modifies production** |
| C-14 | Post-release drift capture | E4 | C-12 (after C-13) | read-only on production |
| C-15 | H-10 host verification | E6 | A-03 (after C-12) | read-only |
| C-16 | N2.10 release (GATED) | E6 | C-09, C-14, OD-05 | **modifies production** |
| C-17 | N4.7 counts | E6 | C-12, OD-07 | read-only (your UI data entry first) |
| C-18 | Weekly production measurements | E6 | C-12 | read-only |
| D-01 | Benchmark gate | E4 | A-10, OD-08 | BLOCKED |
| D-02 | Outage drill | E4 | A-10 | BLOCKED |
| D-03 | Live onboarding per pair | E5 | B-02 | BLOCKED |
| D-04 | Intercom → Linear link shape | E5 | – | BLOCKED |
| D-05 | Third-party rotation (GATED) | E6 | C-15 | BLOCKED · **modifies production** |
| D-06 | Sentry source maps (GATED) | E5/E6 | D-05, C-12 | BLOCKED · **modifies production** |
| D-07 | Legal review | external | – | BLOCKED |
| D-08 | N9 focused tests | E2 | B-03 | BLOCKED |
| E-01 | Evidence review | E1 | all | read-only |
| E-02 | Full suite on synced `testing` | E2 | B-06, B-07, OD-04 | local branch |

**Independent starting points:** A-01, A-02, A-11 (local) and A-03, A-10 (host) can start at once; Phase B can run in parallel with C-01–C-10; every D item waits only on its own prerequisite.

**First safe check:** **A-01** on your machine (read-only), then **A-03** on the host (read-only), whose confirmed `ENV_FILE` and `APP_DB` every later host command uses.
