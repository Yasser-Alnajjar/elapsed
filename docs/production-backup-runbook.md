# Production backup runbook

A manual, one-off backup of the production database: before a migration, a risky deploy, or any change you may need to undo. Written from the pre-N3 backup taken on 2026-10-02 (`backups/pre-n3-elapsed_db-20261002T033846Z.dump`).

For the scheduled (cron) backups, see the "Backups" section of [deployment.md](deployment.md).

## Where things are

| | Value |
|---|---|
| Server | EC2 host, `ssh -i /path/to/your-key.pem ubuntu@13.62.74.24` |
| Project directory | `~/elapsed` |
| Compose file / env file | `docker-compose.yml` / `.env` |
| Compose service (container) | `postgres` |
| Database user | the container's own `$POSTGRES_USER` (no password typed on the command line) |
| **Application database** | **`elapsed_db`** |
| Backups directory | `~/elapsed/backups` (mode `700`, files `600`) |

**Every command below runs on the server, from `~/elapsed`**, except the off-host copy (step 3), which runs on your Mac.

## Before you start: two traps

1. **The app's data is in `elapsed_db`, not the container's default database.** The `postgres` container also has `sla_breach_monitoring` (its `POSTGRES_DB`), which is empty (about 7.5 MB). Always name `elapsed_db` explicitly. `scripts/backup.sh` without `DB_NAME=elapsed_db` dumps the empty database and still looks successful.
2. **`scripts/backup.sh` deletes dumps older than 14 days** (`RETENTION_DAYS`, files matching `sla-*.dump`). For a one-off backup, use the commands below instead. Their file name starts with `pre-`, so the cron rotation never deletes them.

Also: the `migrate` service runs automatically every time the stack comes up (`docker compose up`, a deploy, a restart that recreates containers). **Do not pull new code or restart the stack between taking the backup and deciding to migrate.**

## 1. Confirm which database holds the data

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "select datname, pg_size_pretty(pg_database_size(datname)) from pg_database where not datistemplate"'
```

Expected: `elapsed_db` is the large one (78 MB on 2026-10-02). `postgres` and `sla_breach_monitoring` are small and empty.

Record the current migration state, so you can tell later whether anything ran after the backup:

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d elapsed_db -Atc "select count(*) from _prisma_migrations; select migration_name, finished_at from _prisma_migrations order by started_at desc limit 3"'
```

## 2. Take the backup

Change the `pre-n3` label to describe what the backup is for.

```bash
mkdir -p backups && chmod 700 backups && umask 077 && STAMP=$(date -u +%Y%m%dT%H%M%SZ) && docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d elapsed_db --format=custom --no-owner' < /dev/null > "backups/pre-n3-elapsed_db-$STAMP.dump" && echo "backups/pre-n3-elapsed_db-$STAMP.dump"
```

It prints the file path. Note it down; the steps below call it `<DUMP>`.

Check that it is non-empty and readable:

```bash
ls -lh backups/pre-*-elapsed_db-*.dump
```

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres pg_restore --list < <DUMP> | grep -c "TABLE DATA"
```

Expected: a size in megabytes (4.9 MB on 2026-10-02; custom format is compressed, so it is much smaller than the database), and a count equal to the number of tables (29 as of N3, including `_prisma_migrations`). A size of a few KB means you dumped the wrong database.

## 3. Copy it off the server (on your Mac)

A backup on the same disk as the database doesn't protect against losing the server.

```bash
scp -i /path/to/your-key.pem ubuntu@13.62.74.24:~/elapsed/backups/<DUMP-FILE-NAME> ~/Workspace/ideas/SLA-breach-monitoring/backups/
```

`backups/` is git-ignored locally; never commit a dump.

## 4. Test the restore into a separate database

This never touches `elapsed_db`. **Check that the name ends in `_restore_check` before pressing Enter on `dropdb`.**

Drop any previous scratch copy (a restore into a non-empty database fails with "already exists"):

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists elapsed_db_restore_check'
```

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" elapsed_db_restore_check'
```

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d elapsed_db_restore_check --no-owner --exit-on-error' < <DUMP>
```

No output means success. Compare live and restored:

```bash
for db in elapsed_db elapsed_db_restore_check; do docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $db -Atc \"select '$db', (select count(*) from cases), (select count(*) from evaluations), (select count(*) from integrations), (select count(*) from _prisma_migrations)\""; done
```

How to read it:

- `cases` and `integrations` should match exactly.
- `evaluations` may be slightly higher on live: the worker keeps writing after the dump.
- **`_prisma_migrations` must match.** If live is higher, migrations ran after the backup. List them before doing anything else:

```bash
for db in elapsed_db elapsed_db_restore_check; do echo "== $db"; docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $db -Atc \"select migration_name, started_at, finished_at from _prisma_migrations order by started_at desc limit 4\""; done
```

```bash
docker compose -f docker-compose.yml --env-file .env ps -a migrate && docker compose -f docker-compose.yml --env-file .env logs --timestamps migrate | tail -20
```

When you are done with the check, drop the scratch copy (same `dropdb` command as above).

## 5. Restoring production from the backup (only if you must roll back)

This **replaces all data** in `elapsed_db`. Stop the app first so nothing writes mid-restore, and take a fresh backup of the current state (step 2) before you start.

```bash
docker compose -f docker-compose.yml --env-file .env stop web worker
```

```bash
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d elapsed_db --clean --if-exists --no-owner --single-transaction --exit-on-error' < <DUMP>
```

`--single-transaction` means a restore that fails partway leaves the old data in place.

Before starting the app again, make sure the code on the server matches the restored schema. Otherwise `migrate` re-applies the newer migrations on the next `up`:

```bash
docker compose -f docker-compose.yml --env-file .env start web worker
```

`scripts/restore.sh` does the same thing, but it defaults to the container's `POSTGRES_DB` (set `DB_NAME=elapsed_db`). It also runs `scripts/backup.sh` as a safety backup, which prunes dumps older than 14 days unless you set `SKIP_SAFETY_BACKUP=1` or a large `RETENTION_DAYS`.

## Checklist

- [ ] Step 1: data is in `elapsed_db`; migration count recorded
- [ ] Step 2: dump written, size in MB, table count matches
- [ ] Step 3: dump copied off the server
- [ ] Step 4: scratch restore succeeded; counts match, migration count matches
- [ ] No `git pull`, `docker compose up`, or deploy between the backup and the migration decision
