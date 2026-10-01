# N2 production-backup replay (L1 + L2) — runbook for the EC2 host

> **Run 2026-10-01: L2 0 differences over 7,413 records, L1 0 differences over 5,440** (roadmap N2.11). Corrections learned on the host are marked **[host]** below.

Closes the verification half of roadmap N2.11 (and N1.18's open item). **Scratch database only; the live database is only read by `pg_dump`.** Do not run N2.10 (`packages/db/prisma/contract/…`): it is held out of `prisma/migrations`, so `migrate deploy` cannot apply it.

Tooling (all in the N2 working tree): `apps/worker/scripts/l2-replay.ts` (`pnpm --filter @sla/worker replay:l2`, refuses any database but `sla_restore_drill`), `pnpm --filter @sla/commitments replay:capture` / `replay:compare` (N1.1). Dry-run on a copy of the local dev DB: L2 0 differences over 7,413 records, L1 0 differences over 5,440 records.

## 0. Code on the host

**[host]** The repo is `~/elapsed` (not `/opt/elapsed`), the host has no Node or pnpm, and the live database is `elapsed_db` (`DATABASE_URL`), **not** the compose default `$POSTGRES_DB` (`sla_breach_monitoring`, empty): run `DB_NAME=elapsed_db RETENTION_DAYS=3650 scripts/backup.sh`. Run everything from images instead of installing tooling: the baseline from `elapsed-worker:latest` (the deployed code: `cd /repo/packages/commitments && ../db/node_modules/.bin/tsx src/scripts/replay-capture.ts …`), and the N2 code from a throwaway image: start the worker image as root, `docker cp` the tarball, `rm -rf packages/*/src apps/worker/src apps/worker/scripts packages/db/prisma packages/db/generated`, extract it, add the pnpm links for `@sla/ingestion` (`apps/worker/node_modules/@sla/ingestion -> ../../../../packages/ingestion`, `packages/{zendesk,jira,intercom,linear,github}/node_modules/@sla/ingestion -> ../../../ingestion`, and `core`, `db`, `logger` links inside `packages/ingestion/node_modules/@sla`), `docker commit` it as `elapsed-n2-replay:tmp`, and `docker rmi` it afterwards. Run each step as `docker run --rm --network elapsed_default --user $(id -u):$(id -g) -v ~/n2-replay/out:/out -e DATABASE_URL=<scratch url> -e INTEGRATION_TOKEN_ENCRYPTION_KEY=x -w <dir> --entrypoint sh <image> -c '…'` (`migrate deploy` is `cd /repo/packages/db && node_modules/.bin/prisma migrate deploy`; `l2-replay` runs from `/repo/apps/worker`).

Original plan, if the host had Node and pnpm:

Two trees under `~/n2-replay/`: `base/` = the code that produced the baseline (`main`, what production runs: `git archive main | tar -x -C ~/n2-replay/base`) and `n2/` = the N2 working tree (no commit exists yet: `tar` it from the laptop, excluding `node_modules`, `.next`, `.git`, `packages/*/dist`, `.env*`). In each: `pnpm install --frozen-lockfile` and `DATABASE_URL=<scratch url> pnpm --filter @sla/db generate`. `<scratch url>` is `postgresql://<POSTGRES_USER>:<password>@<postgres host>:5432/sla_restore_drill`; take the credentials from `.env.prod` without echoing them.

## 1. Scratch database from a fresh backup

```sh
cd /opt/elapsed
scripts/backup.sh                                   # read-only pg_dump of the live DB; note the dump name
# restore-drill.sh drops the scratch DB on exit, so restore by hand and keep it:
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$COMPOSE exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists sla_restore_drill && createdb -U "$POSTGRES_USER" sla_restore_drill'
$COMPOSE exec -T postgres sh -c 'pg_restore --username="$POSTGRES_USER" --dbname=sla_restore_drill --no-owner --single-transaction --exit-on-error' < backups/<dump>
```

## 2. Baseline (old code, before any migration)

If the dump is `sla-20260929T213644Z.dump`, the existing `~/n1-replay/baseline/n1-baseline.jsonl` is the baseline. Otherwise recapture it with the **old** code on this scratch DB, at the dump's own timestamp:

```sh
cd ~/n2-replay/base && DATABASE_URL=<scratch url> pnpm --filter @sla/commitments replay:capture -- --as-of <dump timestamp, ISO> --out ~/n2-replay/baseline.jsonl
```

## 3. Migrate the scratch DB, then L2 and L1 with the N2 code

```sh
cd ~/n2-replay/n2
export DATABASE_URL=<scratch url>
pnpm --filter @sla/db exec prisma migrate deploy      # expect N1 migrations still pending in prod + 20261001100000_sla_import_summary_provider; N2.10 must NOT appear
pnpm --filter @sla/worker replay:l2 -- --out-dir ~/n2-replay/out      # expect: differences 0, recordFailures 0, normalizedEventIds.identical true
pnpm --filter @sla/worker replay:l2 -- --out-dir ~/n2-replay/out2     # second run: still 0 (idempotent)
pnpm --filter @sla/commitments replay:capture -- --as-of <same ISO> --out ~/n2-replay/after.jsonl
pnpm --filter @sla/commitments replay:compare -- ~/n2-replay/baseline.jsonl ~/n2-replay/after.jsonl
```

Pass criteria: L2 `differences` 0 and `recordFailures` 0; L1 "class A unapproved: 0"; class C drift reported (N1.2 recorded 0 status / 10 `breachedAt` of 3,921). Any difference is stopped and classified (D24) before anything else happens. Also check: `select count(*) from customer_identities` equals the non-null legacy columns, and no case has a null `sourceIntegrationId` (N2.10's own precondition).

## 4. Clean up

`dropdb sla_restore_drill`; keep `~/n2-replay/*.jsonl` and `out*/` on the host only (customer data, never in git); never `down -v`.
