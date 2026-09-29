Those scripts are fixture writers, not H-1 tooling. They create 11 fake organizations with connected-looking Zendesk/Jira integrations, users, cases, policies, events, commitments, and evaluations. They have no production-environment guard, so do **not** let them inherit the production `DATABASE_URL`.

Use a separate, already-migrated scratch database. The production worker image excludes `.env`, while the package script explicitly tries to load it, so invoke the CLI directly inside a one-off `worker` container:

```bash
export SEED_DATABASE_URL='postgresql://USER:PASSWORD@postgres:5432/YOUR_SCRATCH_DB?schema=public'
```

If the scratch database is new, apply its schema first:

```bash
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -e DATABASE_URL="$SEED_DATABASE_URL" \
  migrate
```

Seed all 11 fixture organizations from the fixed deterministic anchor:

```bash
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -e DATABASE_URL="$SEED_DATABASE_URL" \
  worker \
  pnpm exec tsx scripts/seed-test-customers/cli.ts seed
```

Validate:

```bash
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -e DATABASE_URL="$SEED_DATABASE_URL" \
  worker \
  pnpm exec tsx scripts/seed-test-customers/cli.ts validate
```

For a clean rebuild, which deletes only the fixed fixture organizations in that target database:

```bash
docker compose -f docker-compose.yml --env-file .env.prod run --rm --no-deps \
  -e DATABASE_URL="$SEED_DATABASE_URL" \
  worker \
  pnpm exec tsx scripts/seed-test-customers/cli.ts seed --reset
```

Useful options:

```bash
# Seed or validate only selected fixture tenants
... cli.ts seed --tenants=halcyon,nimbus
... cli.ts validate --tenants=halcyon,nimbus

# Use a current-hour-derived fixture timeline instead of the fixed default
... cli.ts seed --anchor=now
```

`--no-deps` assumes the Compose Postgres service is already running. The `postgres` hostname is correct only from inside the Compose network. The seed intentionally makes no Zendesk, Jira, Slack, SMTP, or other network calls, but it does write substantial database fixture data. [CLI behavior](/Users/yasseralnajjar/Workspace/ideas/SLA-breach-monitoring/apps/worker/scripts/seed-test-customers/cli.ts:1) · [seed scope](/Users/yasseralnajjar/Workspace/ideas/SLA-breach-monitoring/apps/worker/scripts/seed-test-customers/seed.ts:1)
