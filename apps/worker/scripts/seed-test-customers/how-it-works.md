Those scripts are fixture writers, not H-1 tooling. They create 11 fake organizations with connected-looking Zendesk/Jira integrations, users, cases, policies, events, commitments, and evaluations. They have no production-environment guard, so do **not** let them inherit the production `DATABASE_URL`.

Run them **locally, against the development database only** (roadmap section 7, "Testing environment"); never on a server. Use a separate scratch database on the local `docker-compose.dev.yml` Postgres, with `test` in its name, and point `DATABASE_URL` at it explicitly so the root `.env` is never used:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.dev.yml exec -T postgres createdb -U user sla_seed_test   # once
export DATABASE_URL='postgresql://user:password@localhost:5432/sla_seed_test?schema=public'
```

Before seeding, refuse to continue unless the target is a local scratch database:

```bash
case "$DATABASE_URL" in
  postgresql://*@localhost:*/*test*|postgresql://*@127.0.0.1:*/*test*) ;;
  *) echo "refused: DATABASE_URL is not a local *test* database" >&2; false ;;
esac
```

Generate the Prisma client, and if the scratch database is new, apply its schema:

```bash
pnpm --filter @sla/db generate
pnpm --filter @sla/db exec prisma migrate deploy
```

Seed all 11 fixture organizations from the fixed deterministic anchor, validate, or rebuild (`--reset` deletes only the fixed fixture organizations in that target database):

```bash
cd apps/worker
pnpm exec tsx scripts/seed-test-customers/cli.ts seed
pnpm exec tsx scripts/seed-test-customers/cli.ts validate
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

The seed intentionally makes no Zendesk, Jira, Slack, SMTP, or other network calls, but it does write substantial database fixture data. [CLI behavior](cli.ts) · [seed scope](seed.ts)
