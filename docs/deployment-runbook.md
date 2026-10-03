# Production Docker Deployment Runbook

This document describes the correct deployment flow for the Elapsed production Docker stack.

The stack consists of:

- PostgreSQL
- Web application
- Background worker
- Prisma database migrations

> **Important:** The production Compose file intentionally does **not** run Prisma migrations automatically. Migrations must be applied explicitly before starting the application containers.

---

## 1. Prerequisites

From the project root:

```bash
pwd
```

Make sure the repository contains:

```text
docker-compose.prod.yml
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
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  down -v --remove-orphans
```

Verify that the project containers are gone:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps -a
```

Optionally verify the project volume:

```bash
docker volume ls | grep sla
```

A clean reset should not leave the previous PostgreSQL data volume in place.

---

# 3. Start PostgreSQL First

Start only PostgreSQL:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d postgres
```

Verify:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Expected:

```text
sla-postgres-1   postgres:16-alpine   ...   Up
```

The output may show:

```text
5432/tcp
```

This is expected.

PostgreSQL does not need to expose port `5432` to the host because the application containers communicate with it through the Docker network.

---

# 4. Apply Prisma Migrations

## This step is mandatory

The application containers do not create the database schema automatically.

The PostgreSQL database starts empty after a fresh Docker volume.

Run the migration using the project's `@sla/db` package:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy
```

### Why this command?

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
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Then check PostgreSQL logs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs postgres
```

---

# 6. Start Web and Worker

After migrations successfully complete:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build
```

Check the complete stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
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
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=100 web
```

### Worker

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=100 worker
```

### PostgreSQL

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=100 postgres
```

Follow worker logs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs -f worker
```

---

# 8. Normal Deployment

For a normal deployment where the PostgreSQL data must be preserved:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build
```

Then apply any new Prisma migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy
```

Then restart the application containers:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d
```

> Do **not** use `down -v` during a normal deployment.

---

# 9. Fresh Database Deployment

Use this procedure when intentionally starting with a completely new database.

```bash
# 1. Remove containers, networks and database volume
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  down -v --remove-orphans

# 2. Start PostgreSQL
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d postgres

# 3. Apply Prisma migrations
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy

# 4. Build and start the application
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build

# 5. Verify
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
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
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy
```

---

## Mistake 2 — Starting the worker before migrations

This can produce errors such as:

```text
The table `public.worker_settings` does not exist
```

Always migrate first.

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
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Then run:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy
```

After migration succeeds:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d
```

---

# 13. Complete Command Reference

### Fresh local environment

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  down -v --remove-orphans

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d postgres

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  ps
```

### Normal deployment

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --user root worker \
  pnpm --filter @sla/db exec prisma migrate deploy

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d
```

### Logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=100 web

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=100 worker

docker compose -f docker-compose.prod.yml --env-file .env.prod \
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
