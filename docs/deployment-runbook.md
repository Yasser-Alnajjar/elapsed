# Production Docker Deployment Runbook

This document describes the correct deployment flow for the Elapsed production Docker stack.

The stack consists of:

- PostgreSQL
- Web application
- Background worker
- Prisma database migrations

> **Important:** `docker-compose.yml` runs Prisma migrations automatically. A one-shot `migrate` service applies every pending migration and exits 0, and `web` and `worker` declare `depends_on: migrate: condition: service_completed_successfully`, so they cannot start against an unmigrated schema. The steps below that run `migrate` by hand are only for applying migrations on their own (for example before a risky deploy, or to see their output) and are otherwise optional. See [deployment.md](deployment.md).

---

## 1. Prerequisites

From the project root:

```bash
pwd
```

Make sure the repository contains:

```text
docker-compose.yml
.env.prod
apps/
packages/
```

Verify that the production environment file exists:

```bash
ls -la .env.prod
```

The following variables are required:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
DATABASE_URL

NEXTAUTH_SECRET
NEXTAUTH_URL

INTEGRATION_CONFIG_ENCRYPTION_KEY
SMTP_ENCRYPTION_KEY
INTEGRATION_TOKEN_ENCRYPTION_KEY
```

`DATABASE_URL` must use the Docker service hostname:

```text
postgres
```

For example:

```text
postgresql://sla:<password>@postgres:5432/sla_breach_monitoring
```

Do **not** use `localhost` in `DATABASE_URL` when Prisma is running inside Docker.

---

# 2. Start From a Completely Fresh Local Docker Environment

Use this only when existing local Docker database data can be deleted.

> **Warning:** `down -v` deletes the PostgreSQL Docker volume and therefore deletes the local database.

Run:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  down -v --remove-orphans
```

Verify that the project containers are gone:

```bash
docker compose -f docker-compose.yml --env-file .env.prod ps -a
```

Optionally verify the project volume:

```bash
docker volume ls | grep postgres-data
```

A clean reset should not leave the previous PostgreSQL data volume in place.

---

# 3. Start PostgreSQL First

Start only PostgreSQL:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d postgres
```

Verify:

```bash
docker compose -f docker-compose.yml --env-file .env.prod ps
```

Expected:

```text
postgres   postgres:16-alpine   ...   Up
```

The output may show:

```text
5432/tcp
```

This is expected.

PostgreSQL does not need to expose port `5432` to the host because the application containers communicate with it through the Docker network.

---

# 4. Apply Prisma Migrations (optional: `up` does it for you)

## Migrations run automatically

The PostgreSQL database starts empty after a fresh Docker volume. The `migrate` service creates the schema when you run `up` (section 6), and `web` and `worker` wait for it to finish successfully.

To apply migrations on their own, run the same service:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate
```

### If you run Prisma yourself (rare)

The repository is a pnpm monorepo.

Prisma belongs to:

```text
packages/db
```

and the package is:

```text
@sla/db
```

Therefore the correct command is:

```bash
pnpm --filter @sla/db exec prisma migrate deploy
```

Do not use:

```bash
pnpm prisma migrate deploy
```

from the repository root.

Also do not run Prisma directly against:

```text
localhost:5432
```

from the host unless PostgreSQL has explicitly been published to the host.

Inside Docker, PostgreSQL is reachable as:

```text
postgres:5432
```

---

# 5. Verify Migration Success

The migration command should report the migrations that were applied.

If it succeeds, the database schema is ready.

If it fails with:

```text
P1001 Can't reach database server
```

check that PostgreSQL is running:

```bash
docker compose -f docker-compose.yml --env-file .env.prod ps
```

Then check PostgreSQL logs:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs postgres
```

---

# 6. Start Web and Worker

After migrations successfully complete:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d --build
```

Check the complete stack:

```bash
docker compose -f docker-compose.yml --env-file .env.prod ps
```

Expected services:

```text
postgres
web
worker
```

---

# 7. Check Logs

### Web

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 web
```

### Worker

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 worker
```

### PostgreSQL

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 postgres
```

Follow worker logs:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs -f worker
```

---

# 8. Normal Deployment

For a normal deployment where the PostgreSQL data must be preserved:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d --build
```

The `up` above runs the `migrate` service first, so any new Prisma migrations are applied before `web` and `worker` start. To apply them on their own first (for example before a risky deploy):

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate
```

Then (re)start the application containers if you ran `migrate` separately:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d
```

> Do **not** use `down -v` during a normal deployment.

---

# 9. Fresh Database Deployment

Use this procedure when intentionally starting with a completely new database.

```bash
# 1. Remove containers, networks and database volume
docker compose -f docker-compose.yml --env-file .env.prod \
  down -v --remove-orphans

# 2. Start PostgreSQL
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d postgres

# 3. (Optional) apply Prisma migrations on their own; `up` below also runs them
docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate

# 4. Build and start the application
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d --build

# 5. Verify
docker compose -f docker-compose.yml --env-file .env.prod ps
```

---

# 10. Important Database Rules

## Never assume `upsert()` creates a missing table

For example:

```text
workerSettings.upsert()
```

can create a **row** when the table exists.

It cannot create:

```text
worker_settings
```

if the table itself does not exist.

The table is created by Prisma migrations.

Therefore:

```text
Fresh PostgreSQL
        ↓
Prisma migrate deploy
        ↓
Database schema
        ↓
Worker
```

is required.

---

# 11. Common Mistakes

## Mistake 1 — Running Prisma from the host

This may load the local `.env` and attempt:

```text
localhost:5432
```

instead of the Docker PostgreSQL service.

Prefer:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate
```

---

## Mistake 2 — Bypassing the `migrate` service

`docker-compose.yml` blocks `web` and `worker` until `migrate` succeeds, so this only happens if you start the containers some other way (for example `docker run` or a different Compose file). It can produce errors such as:

```text
The table `public.worker_settings` does not exist
```

Run `migrate` first, or start the stack with `docker compose up`, which does it for you.

---

## Mistake 3 — Using `down -v` during a normal deployment

This deletes the PostgreSQL volume.

Never use:

```bash
docker compose down -v
```

unless deleting the local database is intentional.

---

## Mistake 4 — Exposing PostgreSQL unnecessarily

The Compose configuration intentionally keeps PostgreSQL internal:

```text
postgres:5432
```

There is no need for:

```yaml
ports:
  - "5432:5432"
```

unless external access is specifically required.

---

# 12. Quick Recovery

If the worker is continuously restarting with:

```text
The table `public.worker_settings` does not exist
```

do not repeatedly restart the worker.

Check PostgreSQL:

```bash
docker compose -f docker-compose.yml --env-file .env.prod ps
```

Then run:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate
```

After migration succeeds:

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d
```

---

# 13. Complete Command Reference

### Fresh local environment

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  down -v --remove-orphans

docker compose -f docker-compose.yml --env-file .env.prod \
  up -d postgres

docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate

docker compose -f docker-compose.yml --env-file .env.prod \
  up -d --build

docker compose -f docker-compose.yml --env-file .env.prod \
  ps
```

### Normal deployment

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  up -d --build

docker compose -f docker-compose.yml --env-file .env.prod \
  run --rm migrate

docker compose -f docker-compose.yml --env-file .env.prod \
  up -d
```

### Logs

```bash
docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 web

docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 worker

docker compose -f docker-compose.yml --env-file .env.prod \
  logs --tail=100 postgres
```

---

# Deployment Principle

The production Compose file intentionally separates **database schema management** from **application startup**.

The required order is:

```text
┌──────────────┐
│   PostgreSQL │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Prisma migrations│
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Web + Worker     │
└──────────────────┘
```

**Never start with Web + Worker and expect Prisma to create the schema.**

Migrations are an explicit deployment step.
