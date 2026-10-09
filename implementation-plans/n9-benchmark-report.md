# N9 — Custom REST capacity benchmark (plan 09 §6.10, N9.7-F1)

> **Status (2026-10-10): every performance criterion passes at 1,000 live cases on the reference machine, in both profiles; N9.7-F1 is NOT closed.** The one mandatory criterion left is the **production-equivalent run**: the production host's instance type is not recorded anywhere in the repository (`docs/capacity-limits.md`, "Where"; the EC2 host in `docs/production-backup-runbook.md` gives no size), no equivalent host was available, and benchmarking on the live production host is excluded (it would load the live system; §6.10 says "never the live database"). Laptop timings also moved by up to 2× between two database containers on the same machine (run 1 and run 2 below), so they do not transfer to another host. **Status: blocked on infrastructure**: all implementation and documentation work is done; the production-equivalent performance and memory criteria are the one remaining dependency ("Status" below). Beta stays disabled (N9.14-F1).
>
> **Owner decision (2026-10-09, Option 2):** the 10 s p95 lock-hold limit applies to **recurring sync only**; first import has its **own, separate bound** (15 s, provisional until the production-equivalent run). The 10 s limit is not a universal limit for every operation.

## Result at 1,000 live cases

| Criterion | Limit | Worst profile | Base profile | Status |
| --- | --- | --- | --- | --- |
| **Recurring sync**: lock hold on every recurring pass (sweep, poll, 1/5/25% changed, guard abort, and the forced re-projections) | ≤ 10 s p95 (N8-S3, approved) | Run 2: slowest p95 **3.9 s** (version activation / rollback). Run 1: slowest p95 **9.6 s** (1% changed) | Run 2: 3.3 s. Run 1: 5.4 s | **Pass** on the reference machine |
| **First import**: lock hold of an initial-projection pass | ≤ 15 s, slowest of ≥ 5 runs (provisional) | Run 2: slowest **13.6 s** of 11 runs (5 on the sweep tick, 5 on the poll tick, 1 cold); two-run import 5.3 s + 9.4 s. Run 1: 11.1 s (one run) | Run 2: slowest 4.1 s. Run 1: 7.0 s (one run) | **Pass** on the reference machine (9% margin, worst profile) |
| **Organization sweep**: wall time of any pass | ≤ 30 s p95 (N8-S3) | 16.4 s (slowest first import, wall) | 5.0 s | **Pass** |
| Every pass classified as expected (`custom_projection_pass`) | — | Yes: every first-import pass `initial_projection`, every other pass `recurring` | Yes | **Pass** |
| Memory | Inside the worker's limit | Peak RSS 839 MB (run 2, first import); 966 MB (run 1). Heap after GC flat (no leak) | 517 MB; 652 MB | The worker has no configured memory limit (`docker-compose.yml`); the margin can only be judged against the production host's memory: **part of the production-equivalent blocker** |
| Linear scaling | No worse than linear | About 3.0 queries and 2.9 ms of lock per live case per pass (run 1, all tiers) | | Pass |
| Abort path cheap, writes nothing | | 0.6 s; nothing written | 0.1 s | Pass |
| **Production-equivalent run** | Same limits | **Not run** | **Not run** | **BLOCKER** |

**Ceiling.** `C = 1,000` (`DEFAULT_LIVE_CASE_CEILING`) is the largest tier that passes on the reference machine: 2,000 fails recurring sync (run 1: worst 1%/5% changed p95 11.5 s / 12.7 s) and first import (worst 22.8 s). No lower ceiling is needed on the evidence available. It is **supported by measurement on the reference machine only**; the production-equivalent run decides whether it stands. Do not raise it without a new report.

**The first-import bound now binds first.** In run 2 the worst-profile first import (13.6 s, 9% under 15 s) is far closer to its limit than recurring sync (3.9 s, 61% under 10 s). On a host about 10% slower than the reference machine for this workload, 1,000 would fail the first-import bound before recurring sync. The earlier expectation that recurring sync would always bind first (first pass 1.16–1.30× the slowest recurring p95, from run 1's single first-pass observations) is **not** borne out: run 2 measured 3.5×.

## Acceptance rules (owner decision 2026-10-09, Option 2; classification and alert rules resolved 2026-10-10)

| | What it bounds | Limit | Status |
| --- | --- | --- | --- |
| **Recurring-sync SLO** | Organization-lock hold of every **recurring** pass | **≤ 10 s p95**, plus organization sweep ≤ 30 s p95 | Approved; passes at 1,000 on the reference machine |
| **First-import bound** | Organization-lock hold of every **initial-projection** pass | **≤ 15 s**, slowest of at least 5 independently seeded runs plus a cold-cache run, worst profile, on both ticks; organization sweep ≤ 30 s still applies | Value validated on the reference machine (13.6 s); **provisional until the production-equivalent run** |
| **Production-equivalent validation** | Both, re-measured on a host equivalent to production | Same limits | **Outstanding: the one remaining blocker** |

A tier passes only if it meets both, and every other §6.10 criterion. Neither limit relaxes the other, and neither relaxes the 30 s organization sweep.

**Which pass is which** (`classifyProjectionPass`, `packages/custom-ticket/src/pass-class.ts`; plan 09 §6.10). By the integration's state, never by the trigger: a pass is an **initial projection** while the first import has not been projected by a successful pass (`backfillCompletedAt` null; or set with no successful pass recorded since, i.e. the pass completing the import or its retry; or no live cases and the pass creates some). Every other pass is **recurring**, including every **forced re-projection** of existing cases: an operator's re-normalization request, a configuration version activation and its rollback. Measured: re-normalization 1.7–2.4 s p95; an activation / rollback that changes every case's priority, on the slower sweep tick, 3.3–3.9 s p95. `normalizeCustom` reports the class on every pass (`custom_projection_pass`), and the harness checks it on every measured pass.

**Alerts during the first import (D13(b), unchanged).** While the import is read, the source has never synced and is stale: breach alerts are held and at-risk alerts carry the stale-data marker. Measured in the two-run import: the in-progress pass claimed 0–2 alerts (at-risk, caveated; never a breach). The pass completing the import is fresh and claims each breach once: 848–886 alert claims per worst-profile first import, inside the lock, included in the 13.6 s. Delivery in the benchmark is refused before connecting (loopback SMTP, public destinations only).

**N8-S3** is read on recurring passes for a Custom REST integration; an initial projection is read against the first-import bound (plan 08 S3, plan 09 §6.10). N8-S3 is a manual review trigger; no code reads it.

**Why 15 s.** (1) It holds the measured first import at the ceiling with margin on the reference machine (13.6 s worst; 4.1 s base). (2) It stays at half of the two 30 s limits that remain in force: the organization sweep (N8-S3) and the webhook-latency trigger (N8-S4), since every other integration's webhooks for that organization wait for the whole hold. (3) It is bounded by construction: the ceiling guard rejects `L + N > C` before projection, so no initial-projection pass creates more than `C` cases; spreading the import over two runs makes each pass smaller (measured: 5.3 s and 9.4 s, worst profile). The value stays **provisional** until the production-equivalent run: a bound that a slower host cannot meet at 1,000 lowers the ceiling; the bound is not raised to fit.

**Measurement variability (stated, not explained away).** On the same laptop, run 1 (the shared dev Postgres container, database `sla_bench_n9`) and run 2 (a dedicated container, database `sla_bench_n9f1`, same image and settings) differ by about 2× on recurring passes (worst sweep p95 4.7 s vs 2.4 s; 1%-changed p95 9.6 s vs 2.6 s) and on the base first import (7.0 s vs 3.5–4.1 s). Within run 2 the worst-profile first import ranged 9.6–13.6 s. An exploratory worst-profile run on the dedicated container, stopped before completion because it measured the first import on the poll tick only, saw 5.7–6.1 s; it is not used. A plausible cause is planner statistics on scratch databases whose tables are nearly empty at seed time (autoanalyze last ran with 0 live cases); it was not verified. The consequence is the same either way: only a run on a production-equivalent host can close the gate, and its acceptance reads the slowest run.

## Status: blocked on infrastructure (2026-10-10)

All implementation, harness, test and documentation work for N9.7-F1 is **done**. The phase is **blocked on one external dependency: a production-equivalent host**. Two acceptance criteria stay open until the run there passes, and laptop results are never substituted for them:

1. **Performance on the target host:** recurring sync ≤ 10 s p95, first import ≤ 15 s (slowest run), organization sweep ≤ 30 s, at 1,000 live cases, both profiles.
2. **Memory headroom:** the run's peak RSS (839 MB worst profile on the laptop, which says nothing about production) judged against the target host's memory available to the worker. The worker has no configured memory limit (`docker-compose.yml`), so the host's memory is the limit.

**Target host requirements.**

| Item | Requirement |
| --- | --- |
| Host | The **same instance type as production** (CPU, memory, storage class). The type is not recorded in the repository; it is read from the production account by the owner. Never the live production host or its database |
| PostgreSQL | Major version 16, the same configuration as production (`shared_buffers`, `work_mem`, `effective_cache_size`, `max_connections`, `synchronous_commit`, storage); the report records them from `pg_settings` |
| Database | A fresh scratch database on that host's Postgres whose name contains `bench` (the harness refuses any other), migrated from the current schema; synthetic data only; dropped afterwards |
| Runtime | Node 22, the repository at the commit under test, `pnpm install`; `.env` with `INTEGRATION_TOKEN_ENCRYPTION_KEY` and `SMTP_ENCRYPTION_KEY` set to **non-production** values |
| Privileges | `sudo` for the cold-cache command (Postgres restart and page-cache drop); no other process using that Postgres during the run |
| Network | None outbound: ingest is paused and alert delivery is refused before connecting |
| Duration | About 30 minutes for both profiles at tier 1,000 |

**Final run (on the target host):**

```bash
set -a; . ./.env; set +a
export DATABASE_URL=postgresql://<user>:<password>@<host>:5432/sla_bench_prodeq
pnpm --filter @sla/db exec prisma migrate deploy
cd packages/custom-ticket
for p in worst base; do
  PERF_METRICS=1 CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000 node --expose-gc --import tsx bench/run.ts \
    --tiers=1000 --profile=$p --reps=5 --first-import-reps=5 --split-reps=3 \
    --cold-cmd="sudo systemctl restart postgresql && sync && echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null && until pg_isready -q; do sleep 0.5; done" \
    --out=bench/results
done
npx tsx bench/report.ts bench/results/<the two new files>.json
```

**Closing it.** Read the "Acceptance" table and the peak RSS. **Both profiles pass and memory fits:** record the tables and the host's specification here, mark N9.7-F1 done in the roadmap; N9.14-F1 step (3) is then satisfied. **A profile fails:** rerun with `--tiers=900,750,600,500`, set `DEFAULT_LIVE_CASE_CEILING` and `.env.example` to the largest tier that passes both limits, record it, then close. The limits are never raised to fit.

## Bottleneck

`deriveBatch` is cheap (0.7 s for 20,000 tickets and 160,000 raw rows) and so is reading the raw rows (1.4 s). **About 95% of the lock time is the shared projector** (`projectCanonicalBatch`): per case, a customer-identity lookup, an unconditional `upsert`, and a `findMany` of its stored events, issued sequentially, on every pass, **even when nothing changed** (plan 09 §6.9 predicted this from the code; it is now measured: 60,424 queries per pass at 20,000). V1 runs the full stored set on every tick (`incrementalNormalization = false`), so the 1%-changed pass costs the same as a no-change pass.

What would raise the ceiling (proposals, not decisions; each needs its own review and the D24 replay because the projector is shared):

1. A no-change fast path in the projector: skip the upsert and the per-case event read when the derived facts and event keys equal a batch-loaded stored snapshot (one query per chunk instead of three per case).
2. The incremental-poll / full-sweep design of §6.1/§6.9, which needs the seven correctness and replay criteria of §6.10 first. **Those criteria were not evaluated: the design is not implemented.**

## Method

- **Harness:** `packages/custom-ticket/bench/` (`seed.ts`, `run.ts`, `report.ts`, `bench-config.json`); raw results in `bench/results/*.json`.
- **What runs:** the worker's real `processOrganization` under the real organization lock: `normalizeCustom` (real `deriveBatch`, real guards, the pass classification), the real projector, commitments, re-resolution, next reply, evaluation, alert claims and delivery. Ingest is skipped by an operator pause, so every figure is the DB-side sweep and lock hold of §6.10, never provider HTTP time. Because the paused worker writes no sync health, the harness sets the two fields ingest and sync health would have left (`cursor.backfillCompletedAt`, `lastSuccessfulSyncAt`; `seed.ts`, `importState`).
- **Data:** synthetic, built exactly as `runCustomIngest` stores it (whitelist projection, content-hashed ids, separate comment rows), never inserted into `Case`/`NormalizedEvent`/`Commitment` directly. A native always-open policy (first response 60 min, resolution 480 min) so commitments, evaluations and alerts are real. 60% of tickets closed with a source closure time; no status history (current-status-only, the harder case for Resolution).
- **Profiles (assumption; no design-partner data exists):** *base* 3 snapshots and 5 comments per ticket, 400-character mapped bodies; *worst* 10 snapshots and 20 comments per ticket, 3,000-character bodies (the plan's upper multiplicities).
- **Passes per tier, run 1:** first pass (initial projection, sweep tick, once); 5 × steady reconciliation sweep; 5 × steady active poll; 5 × poll after new agent replies on 1%, 5% and 25% of tickets; 3 × dry-run diff of a new version (N9.12-F1); 3 × concurrency (the sweep while a webhook-shaped lock waiter arrives 200 ms in and a second 500-ticket organization is processed in parallel); 5 × a pass that the lifecycle guard aborts (every open ticket closed at the source), with a write check.
- **Passes per tier, run 2 (N9.7-F1):** everything in run 1, plus: the **first import on 11 independently seeded organizations** (each its own data): 1 cold-cache run and 5 warm runs on the reconciliation-sweep tick (which evaluates every commitment, the slower tick), and 5 warm runs on the active-poll tick; the organization's alert channel is configured, so the import's breach alerts are claimed inside the lock as in production; **an import read over two runs** (half the tickets with the import in progress and the source stale, then the rest with the import completed), 3 times; **forced re-projections**: 5 × operator re-normalization, 5 × alternating version activation and rollback that change every case's priority (sweep tick). The pass class is recorded for every pass and checked.
- **Cold cache (run 2):** after seeding and before the pass, `docker restart` of the benchmark's Postgres container (empties shared buffers) and `echo 3 > /proc/sys/vm/drop_caches` in the Docker VM (empties the OS page cache), then the harness reconnects.
- **Statistics:** median and nearest-rank p95 of 5 runs (with five runs, p95 is the slowest run). The first-import criterion reads the slowest of all its runs (warm on both ticks, cold, and both passes of the two-run import). Run 1's first pass ran once per tier and profile; those figures are single observations.
- **Environment, run 1 (2026-10-09):** Apple M4, 10 cores, 16 GB; Node 22.17.0; PostgreSQL 16.15 (Alpine) in the shared dev Docker container, `shared_buffers` 128 MB (16384 × 8 kB; the earlier text said 160 MB, a misreading of the harness's run-together `setting` and `unit`, now printed separately), `synchronous_commit` on; fresh scratch database `sla_bench_n9`; warm cache.
- **Environment, run 2 (2026-10-09, 21:09–21:24 UTC):** the same machine, Node and Postgres image and settings (`shared_buffers` 128 MB, `work_mem` 4 MB, `synchronous_commit` on), in a dedicated container `elapsed-bench-pg` (so the cold-cache restarts never touched the dev database; 8 CPUs and 12 GB to Docker), fresh scratch database `sla_bench_n9f1`. `CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000` only so that larger tiers can be measured.
- **Validity note:** a first run on 2026-10-09 was discarded because the machine slept during it; every run reported here ran under `caffeinate` with the machine otherwise idle.

## Results, run 1 (2026-10-09, all tiers)


#### Profile `base` (2026-10-09T19-00-14-833Z-base.json)

| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 8,000 | 3.7 MB | 5,570 | 7.0 | 3.2 / 3.2 | 3.0 / 3.1 | 3,417 | 652 |
| 5,000 | 40,000 | 18.5 MB | 28,027 | 39.6 | 14.6 / 14.7 | 14.1 / 16.4 | 15,432 | 777 |
| 10,000 | 80,000 | 37.0 MB | 56,005 | 81.1 | 34.8 / 35.0 | 27.7 / 28.6 | 30,450 | 1434 |
| 20,000 | 160,000 | 74.1 MB | 112,076 | 126.4 | 57.7 / 58.5 | 58.0 / 59.1 | 60,484 | 1536 |

**Stages of the steady sweep (median ms; queries)**

| Live cases | load raw (ms) | deriveBatch (ms) | normalize | commitment | re_resolution | next_reply | evaluate | notify_claim | notify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 68 | 28 | 2992 (3405) | 7 (1) | 6 (1) | 60 (3) | 91 (6) | 2 (1) | 0 (0) |
| 5,000 | 325 | 137 | 13636 (15409) | 14 (1) | 8 (1) | 396 (11) | 497 (10) | 6 (3) | 0 (0) |
| 10,000 | 650 | 299 | 33099 (30414) | 34 (1) | 16 (1) | 779 (21) | 909 (15) | 6 (3) | 0 (0) |
| 20,000 | 1391 | 671 | 54082 (60424) | 104 (1) | 26 (1) | 1469 (41) | 1950 (25) | 6 (3) | 0 (0) |

**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**

| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 3.1 / 3.2 | 3.2 / 5.4 | 3.9 / 4.7 | 0.4 / 0.4 (yes) | 0.2 / 0.2 | 3878 | 4187 / 2227 | 80, 81, 81, 81, 81 |
| 5,000 | 16.6 / 17.8 | 18.0 / 18.3 | 18.9 / 20.5 | 1.2 / 1.3 (yes) | 0.8 / 0.9 | 17860 | 1972 / 2130 | 85, 85, 85, 85, 85 |
| 10,000 | 28.1 / 29.0 | 29.1 / 29.6 | 31.8 / 32.7 | 2.4 / 2.4 (yes) | 1.8 / 1.8 | 29753 | 1863 / 2761 | 92, 92, 92, 92, 92 |
| 20,000 | 59.4 / 63.3 | 53.0 / 54.4 | 60.6 / 61.8 | 4.8 / 5.2 (yes) | 3.7 / 4.0 | 59731 | 1956 / 4104 | 99, 99, 99, 99, 99 |


#### Profile `base` (2026-10-09T19-59-11-517Z-base.json)

| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 16,000 | 7.4 MB | 11,229 | 13.1 | 5.9 / 6.0 | 6.9 / 9.0 | 6,420 | 701 |
| 3,000 | 24,000 | 11.1 MB | 16,775 | 22.7 | 9.2 / 11.7 | 9.0 / 9.3 | 9,424 | 444 |

**Stages of the steady sweep (median ms; queries)**

| Live cases | load raw (ms) | deriveBatch (ms) | normalize | commitment | re_resolution | next_reply | evaluate | notify_claim | notify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 509 | 141 | 5538 (6406) | 6 (1) | 4 (1) | 157 (5) | 183 (7) | 2 (1) | 0 (0) |
| 3,000 | 178 | 82 | 8246 (9407) | 9 (1) | 5 (1) | 246 (7) | 280 (8) | 3 (1) | 0 (0) |

**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**

| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 7.7 / 14.6 | 6.4 / 11.3 | 7.4 / 9.1 | 0.9 / 1.0 (yes) | 0.5 / 0.9 | 13158 | 2228 / 3089 | 83, 83, 83, 83, 83 |
| 3,000 | 9.1 / 9.4 | 9.3 / 10.2 | 9.6 / 9.6 | 0.8 / 0.8 (yes) | 0.5 / 0.5 | 9377 | 1867 / 1904 | 84, 84, 84, 84, 84 |


#### Profile `worst` (2026-10-09T20-08-40-312Z-worst.json)

| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 30,000 | 7.2 MB | 18,570 | 11.1 | 4.2 / 4.7 | 4.3 / 6.4 | 3,417 | 966 |
| 2,000 | 60,000 | 14.5 MB | 37,229 | 22.8 | 8.0 / 8.8 | 7.6 / 7.7 | 6,420 | 1043 |

**Stages of the steady sweep (median ms; queries)**

| Live cases | load raw (ms) | deriveBatch (ms) | normalize | commitment | re_resolution | next_reply | evaluate | notify_claim | notify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1136 | 112 | 3763 (3405) | 6 (1) | 6 (1) | 163 (3) | 210 (6) | 9 (1) | 0 (0) |
| 2,000 | 1582 | 199 | 7245 (6406) | 8 (1) | 4 (1) | 324 (5) | 406 (7) | 4 (1) | 0 (0) |

**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**

| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 5.4 / 9.6 | 4.9 / 6.1 | 5.6 / 6.6 | 1.7 / 1.8 (yes) | 1.5 / 1.6 | 5967 | 2222 / 4053 | 81, 81, 81, 80, 79 |
| 2,000 | 9.1 / 11.5 | 9.5 / 12.7 | 8.9 / 9.1 | 2.6 / 3.0 (yes) | 2.0 / 2.4 | 9203 | 1860 / 3837 | 82, 81, 82, 82, 82 |



"Webhook blocked" is the time a webhook-shaped waiter that arrived 200 ms after the sweep started waited for the lock: it is the whole remaining lock hold, as expected.

## Results, run 2 (2026-10-09, N9.7-F1 acceptance run, tier 1,000)

#### Profile `worst` (2026-10-09T21-09-57-088Z-worst.json)

| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 30,000 | 7.2 MB | 18,591 | 9.6 | 2.0 / 2.4 | 1.7 / 2.3 | 3,420 | 583 |

**Stages of the steady sweep (median ms; queries)**

| Live cases | load raw (ms) | deriveBatch (ms) | normalize | commitment | re_resolution | next_reply | evaluate | notify_claim | notify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 382 | 54 | 1755 (3406) | 5 (1) | 2 (1) | 105 (3) | 128 (6) | 3 (3) | 0 (0) |

**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**

| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.3 / 2.6 | 1.6 / 1.6 | 1.8 / 2.0 | 0.5 / 0.6 (yes) | 0.4 / 0.4 | 1450 | 710 / 718 | 81, 81, 81, 81, 81 |

**First import (initial projection), lock hold (s); each run on its own freshly seeded organization**

| Live cases | Sweep tick: warm runs (s) | Sweep tick: median / p95 (s) | Poll tick: median / p95 (s) | Cold run, sweep tick (s) | Wall, slowest run (s) | Two-run import: first / second pass p95 (s) | Alerts claimed per run (sweep tick) | Pass class |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1,000 | 9.8, 10.8, 10.7, 10.5, 9.6 | 10.5 / 10.8 | 11.6 / 13.6 | 11.7 | 16.4 | 5.3 / 9.4 | 882, 874, 848, 870, 871 | initial_projection |

**Forced re-projections of existing cases (lock hold median / p95, s)**

| Live cases | Operator re-normalization | Version activation / rollback (every case changes) | Pass class |
| ---: | ---: | ---: | --- |
| 1,000 | 1.7 / 1.7 | 2.6 / 3.9 | recurring |

**Acceptance (N9.7-F1): recurring lock hold ≤ 10 s p95, first import ≤ 15 s (slowest of warm and cold runs), organization sweep ≤ 30 s p95**

| Live cases | Slowest recurring p95 (s), pass | First import, slowest run (s) | Slowest sweep wall p95 (s) | Every pass classified as expected | Verdict |
| ---: | ---: | ---: | ---: | --- | --- |
| 1,000 | 3.9 (activation / rollback) | 13.6 | 16.4 | yes | **pass** |

_Environment: see Method, run 2._

#### Profile `base` (2026-10-09T21-16-26-873Z-base.json)

| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 8,000 | 3.7 MB | 5,591 | 3.5 | 1.5 / 1.8 | 1.9 / 2.2 | 3,420 | 319 |

**Stages of the steady sweep (median ms; queries)**

| Live cases | load raw (ms) | deriveBatch (ms) | normalize | commitment | re_resolution | next_reply | evaluate | notify_claim | notify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 32 | 15 | 1351 (3406) | 4 (1) | 3 (1) | 46 (3) | 61 (6) | 7 (3) | 0 (0) |

**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**

| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1.2 / 1.6 | 2.6 / 2.7 | 2.4 / 2.9 | 0.1 / 0.1 (yes) | 0.1 / 0.1 | 1466 | 844 / 953 | 81, 81, 81, 81, 81 |

**First import (initial projection), lock hold (s); each run on its own freshly seeded organization**

| Live cases | Sweep tick: warm runs (s) | Sweep tick: median / p95 (s) | Poll tick: median / p95 (s) | Cold run, sweep tick (s) | Wall, slowest run (s) | Two-run import: first / second pass p95 (s) | Alerts claimed per run (sweep tick) | Pass class |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1,000 | 3.8, 3.6, 3.8, 4.1, 3.5 | 3.8 / 4.1 | 3.6 / 3.7 | 3.8 | 5.0 | 1.9 / 3.3 | 882, 874, 848, 870, 871 | initial_projection |

**Forced re-projections of existing cases (lock hold median / p95, s)**

| Live cases | Operator re-normalization | Version activation / rollback (every case changes) | Pass class |
| ---: | ---: | ---: | --- |
| 1,000 | 1.8 / 2.4 | 2.4 / 3.3 | recurring |

**Acceptance (N9.7-F1): recurring lock hold ≤ 10 s p95, first import ≤ 15 s (slowest of warm and cold runs), organization sweep ≤ 30 s p95**

| Live cases | Slowest recurring p95 (s), pass | First import, slowest run (s) | Slowest sweep wall p95 (s) | Every pass classified as expected | Verdict |
| ---: | ---: | ---: | ---: | --- | --- |
| 1,000 | 3.3 (activation / rollback) | 4.1 | 5.0 | yes | **pass** |

_Environment: see Method, run 2._

## Reproduce

```bash
set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL%/*}/sla_bench_<name>"   # a fresh, migrated scratch database; the harness refuses names without "bench"/"test"
pnpm --filter @sla/db exec prisma migrate deploy
cd packages/custom-ticket
# The N9.7-F1 acceptance run (run 2). <cold> empties Postgres's and the OS's caches and waits until Postgres accepts connections again:
#   in Docker: docker restart <container> && docker run --rm --privileged --entrypoint sh postgres:16-alpine -c "sync; echo 3 > /proc/sys/vm/drop_caches"
#   on a Linux host: sudo systemctl restart postgresql && sync && echo 3 | sudo tee /proc/sys/vm/drop_caches
for p in worst base; do
  PERF_METRICS=1 CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000 caffeinate -dimsu pnpm bench --tiers=1000 --profile=$p --reps=5 --first-import-reps=5 --split-reps=3 --cold-cmd="<cold>" --out=<dir>
done
# Run 1 (all tiers):
PERF_METRICS=1 CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000 caffeinate -dimsu pnpm bench --tiers=1000,2000,3000,5000,10000,20000 --profile=base --reps=5 --out=<dir>
pnpm exec tsx bench/report.ts <dir>/*.json
```

`caffeinate` is macOS; on Linux run without it. On the production-equivalent host, run against a scratch database on that host's Postgres (never the live database), then follow "Status: blocked on infrastructure".
