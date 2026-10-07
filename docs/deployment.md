# Deployment

This covers running Elapsed on your own infrastructure with Docker — a VPS, a
bare-metal box, or any host that can run `docker compose`. There is no
managed-hosting target; this is the self-host path.

The stack is three containers:

- **postgres** — the database.
- **web** (`apps/web`) — the Next.js app: sign-in, dashboard, settings,
  webhook receivers.
- **worker** (`apps/worker`) — the background poller: OAuth token refresh,
  event ingestion, SLA/OLA evaluation, notifications.

Both app containers are stateless and read/write nothing but Postgres —
there's no shared filesystem between them to worry about.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose version`) on the
  host.
- A Postgres instance reachable from the host — either the `postgres`
  service in [`docker-compose.yml`](../docker-compose.yml), or
  your own managed database, in which case skip that service and point
  `DATABASE_URL` at it.

## 1. Configure environment

Create `.env.prod` on the host from [`.env.prod.example`](../.env.prod.example),
then generate its secrets. `.env.prod` is gitignored: it lives only on the
host and in your secure backups, never in the repository.
`docker-compose.yml` refuses to start any service that's missing a
required variable, so this errors loudly rather than booting with blanks:

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
scripts/rotate-secrets.sh .env.prod
```

`scripts/rotate-secrets.sh` replaces the `change-me` placeholders for
`POSTGRES_PASSWORD` (and the matching password in `DATABASE_URL`),
`NEXTAUTH_SECRET`, and all three encryption keys with fresh random values,
without printing them. Then set `NEXTAUTH_URL` and any optional values by
hand.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | web, worker | `postgresql://user:password@host:5432/db?schema=public`. If you're using the bundled `postgres` service, the host is `postgres` (the Compose service name) and the user/password/db must match `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` below. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | postgres | Only read by the bundled `postgres` service. Omit if you're pointing `DATABASE_URL` at your own database instead. |
| `NEXTAUTH_SECRET` | web | Random secret used to sign session tokens. Generate one with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | web, worker | The public URL the app is served at, e.g. `https://sla.example.com`. The worker uses this to build OAuth redirect URIs — it must match what's registered with each provider. The web app also builds its SEO output from it (canonical URLs, `sitemap.xml`, `robots.txt`, structured data): see [Search engine indexing](#search-engine-indexing). |
| `PLATFORM_ADMIN_EMAILS` | web | Comma-separated emails of the platform operators who run this deployment. Only these accounts (checked server-side against the signed-in session's email, not a `UserRole`) may change Worker/Monitoring settings; every tenant, including an org owner, gets a read-only view. |
| `INTEGRATION_CONFIG_ENCRYPTION_KEY` | web, worker | Encrypts each org's Zendesk/Jira/Slack OAuth client secrets at rest. Generate with `openssl rand -base64 32`. Rotating it invalidates every saved integration config. |
| `SMTP_ENCRYPTION_KEY` | web, worker | Encrypts each org's saved SMTP password at rest. Generate with `openssl rand -base64 32`, keep distinct from the other encryption keys so rotating one doesn't invalidate the others. |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | web, worker | Encrypts each connected integration's OAuth access/refresh tokens at rest. Generate with `openssl rand -base64 32`, keep distinct from the other encryption keys. Rotating it makes every connected integration's tokens unreadable — each organization must reconnect. Existing plaintext rows from before this key was introduced are migrated with `pnpm db:encrypt-tokens`. |
| `WORKER_ACTIVE_POLL_MS`, `WORKER_RECONCILIATION_MS` | web, worker | Optional; bootstrap defaults are 300000 (5 min) and 1800000 (30 min — also the maximum for reconciliation; a larger saved or env value is capped at 30 min), used only to seed the database on a fresh install. Once a platform operator changes either interval from the Monitoring settings page, the saved database value is authoritative and these env vars are no longer read. |
| `SENTRY_DSN` | web, worker | Optional. Enables error tracking in both apps when set; omit it and the SDK stays disabled with no other effect. See [Health checks and observability](#health-checks-and-observability). |
| `SMTP_ALLOW_PRIVATE_HOSTS` | web, worker | Optional. Set to `1` to let an **organization's** own SMTP settings (Settings → Notifications) point at a private, loopback or link-local address, for example a Mailpit container in local development or an intranet relay. Unset (the default) refuses those destinations on save, on Test Connection / Send Test Email and on every alert send. Deployment-wide SMTP and ops-alert SMTP are operator-configured and are not affected. |
| `WORKER_HEALTH_PORT` | worker | Optional, defaults to `8081`. The port `GET /health` listens on inside the worker container. |
| `WORKER_LOCK_RETRY_MS`, `WORKER_LOCK_PING_MS` | worker | Optional, default `15000` and `30000`. How often a worker retries the advisory lock that elects the stalled-work watchdog, and how often the holder checks its lock connection is still alive. Organization work itself is divided by per-organization leases, not by this lock; see [Running multiple workers](#running-multiple-workers). |
| `OPS_ALERT_SLACK_WEBHOOK_URL`, `OPS_ALERT_EMAIL` | worker | Optional. Where a stalled-worker-cycle alert goes — see [Health checks and observability](#health-checks-and-observability). This is a deployment-owner channel, unrelated to any organization's own SLA breach notifications. `OPS_ALERT_EMAIL` is only the recipient; its SMTP transport is the shared `DEPLOYMENT_SMTP_*` below, so email alerting stays off if that's unset. |
| `DEPLOYMENT_SMTP_*` | web, worker | Deployment-owned SMTP, shared by every deployment-level email concern: account-lifecycle email sent from web (invitations, password resets, email verification — required, fails explicitly if unset when triggered) and worker's ops alert above (optional — that channel just stays off if unset). Deliberately separate from an organization's own saved SMTP (Settings → Notifications, used only for SLA breach/at-risk alerts, customer-owned) — that's the boundary that matters; there's no separate SMTP transport per deployment-level feature, since both already go through the same mailer. Whichever SMTP delivers it, every email is rendered by the one Elapsed template layout in `@sla/email` (see `packages/email/README.md`); its footer links to `NEXTAUTH_URL` and the logo is embedded in the message, so no extra setting is needed. |

None of these secrets are baked into the images — the Dockerfiles only ever
see fixed placeholder values at build time (see the comments in
[`apps/web/Dockerfile`](../apps/web/Dockerfile) and
[`apps/worker/Dockerfile`](../apps/worker/Dockerfile)). Real values are
supplied at container start via `environment:`/`--env-file`, the same as any
other 12-factor deployment.

## 2. Build and start

```bash
docker compose -f docker-compose.yml --env-file .env.prod up -d --build
```

This builds `apps/web/Dockerfile`, `apps/worker/Dockerfile`, and
`packages/db/Dockerfile` from the repo root, and starts every service in
order (roadmap 7.1): `postgres` becomes healthy, then the one-shot
`migrate` service applies every pending Prisma migration and exits 0, then
`web` and `worker` start — both `depends_on: migrate: condition:
service_completed_successfully`, so neither can come up against an
unmigrated schema, and `up`'s own dependency graph blocks on that exit
rather than needing a separate step below.

## 3. Migrations after an update

The first `up` above already applies every migration that existed at that
point — there's no separate first-run step anymore. After pulling a later
update that adds new migrations, re-run `up` and the same `migrate`
service applies them before `web`/`worker` restart:

```bash
git pull
docker compose -f docker-compose.yml --env-file .env.prod up -d --build
```

If you only need to force the migration step on its own (rare — `up`
already runs it), you can still invoke it directly:

```bash
docker compose -f docker-compose.yml --env-file .env.prod run --rm migrate
```

## 4. Create the first account

Sign-up is self-serve — visit `${NEXTAUTH_URL}/sign-up` and create an
account with an email and password (see
[Getting Started](customer-guide.md#4-getting-started)). There is no separate seed/admin
bootstrap step.

## Updating

```bash
git pull
docker compose -f docker-compose.yml --env-file .env.prod up -d --build
```

Migrations run automatically as part of `up` (see above) — there is no
separate migration command to remember on update.

## Backups

The database is the only state this stack has: both app containers are
stateless. Back it up on a schedule, keep copies off the host, and practice
a restore before you need one.

For a one-off backup before a migration or risky deploy on the production
EC2 host, follow [production-backup-runbook.md](production-backup-runbook.md).

### What to back up

1. **The database**, with [`scripts/backup.sh`](../scripts/backup.sh).
2. **`.env.prod`**, stored separately and securely (for example, in a
   password manager). A database dump without the matching
   `INTEGRATION_CONFIG_ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY`, and
   `INTEGRATION_TOKEN_ENCRYPTION_KEY` still restores, but every saved
   integration OAuth secret, connected integration's tokens, and SMTP
   password in it becomes unreadable, and each organization would have to
   re-enter/reconnect them. Never put `.env.prod` in the same place as the
   dumps: whoever holds both holds everything.

### Scheduled backups

`scripts/backup.sh` runs `pg_dump` inside the `postgres` container. It
writes a compressed, custom-format dump to `backups/sla-<UTC timestamp>.dump`
(owner-only permissions), confirms `pg_restore` can read it, and only then
deletes dumps older than `RETENTION_DAYS`. A failed or unreadable dump exits
non-zero and leaves the previous backups in place.

Run it once by hand to check it works:

```bash
scripts/backup.sh
```

Then schedule it with the host's crontab (`crontab -e`). This takes a
backup at 03:15 every day and logs the output:

```cron
15 3 * * * cd /srv/sla && scripts/backup.sh >> /var/log/sla-backup.log 2>&1
```

Replace `/srv/sla` with the checkout path. Settings are environment
variables, set inline in the cron line if you need them:

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Ignored by git. |
| `RETENTION_DAYS` | `14` | Dumps older than this are deleted after each successful backup. |
| `COMPOSE_FILE` | `docker-compose.yml` | |
| `ENV_FILE` | `.env.prod` | |
| `DB_NAME` | the container's `POSTGRES_DB` | |

**Copy dumps off the host.** A backup on the same disk as the database
won't survive losing the server. Set `OFFSITE_COPY_CMD` to a command that
copies one dump, given as `$1`; `backup.sh` runs it after each good dump and
exits non-zero if it fails (the local dump is kept):

```cron
15 3 * * * cd /opt/elapsed && OFFSITE_COPY_CMD='aws s3 cp "$1" s3://my-bucket/sla/' scripts/backup.sh >> /var/log/sla-backup.log 2>&1
```

`rclone copy "$1" remote:sla` or `restic backup "$1"` work the same way. Local
retention is `RETENTION_DAYS`; set the off-site retention on the bucket itself
(an S3 lifecycle rule, for example 30 days) so a compromised host can't delete
its own off-site history.

If you run your own managed Postgres instead of the bundled service, use the
provider's automated snapshots and point-in-time recovery; these scripts
only target the bundled `postgres` container.

### Restoring

`scripts/restore.sh` replaces the database's entire contents with a dump.

```bash
scripts/restore.sh backups/sla-20260916T031500Z.dump
```

In order, it:

1. Checks the file is a readable dump.
2. Asks you to type the database name. Pass `--yes` to skip the prompt.
3. Takes a safety backup of the current data, so a mistaken restore can be
   undone. Set `SKIP_SAFETY_BACKUP=1` to skip it.
4. Stops `web` and `worker` so nothing writes mid-restore.
5. Restores in a single transaction. If anything fails, the old data stays.
6. Starts `web` and `worker` again, even if the restore failed.

After restoring, run migrations in case the dump predates the running code
(the command under [Updating](#updating)), then check `GET /api/health`.
Each integration's sync cursor is restored along with the data, so the
worker re-fetches provider changes made since the dump on its next cycles.
OAuth tokens are restored as they were at dump time too. If a provider
rotated a refresh token after that, the integration shows **Needs
reconnect**, and one click on the Integrations page fixes it.

### Test the restore

An untested backup is a guess. Once a quarter, and after any change to the
setup, run the drill on the host:

```bash
scripts/restore-drill.sh
```

It restores the newest dump (or the one you pass) into a scratch database
next to the real one, times the restore, checks that the tables and `cases`
rows are there, drops the scratch database, and appends a line to
`docs/restore-drills.log` (dump, size, restore seconds, table and case counts;
the script creates the file on first use, and it is not part of the repository
until you commit one). It never stops `web` or `worker`. Commit the log line so
the recorded timing is the recovery-time figure you quote.

## Search engine indexing

The public pages (home, pricing, about, terms, privacy and the product docs) are built to be indexed; everything else (the signed-in app, admin, API, OAuth callbacks, webhooks and the emailed-token pages) is blocked in `robots.txt` and marked `noindex`. Sitemap, canonical URLs, Open Graph/Twitter tags and structured data are all generated at request time from `NEXTAUTH_URL`, so no separate SEO setting exists.

Indexing is only switched on when `NEXTAUTH_URL` is a real public origin: `https` and a domain name. For anything else (`localhost`, a bare IP address such as `https://203.0.113.7`, a dev tunnel, a `.local`/`.internal`/`.test` name, `example.com`, or an unset value) the app serves `Disallow: /` in `robots.txt`, an empty `sitemap.xml`, `noindex` on every page and no structured data, so a staging or IP-only deployment can never end up in a search index.

To go live in search: serve the app on its domain, set `NEXTAUTH_URL` to that origin (`https://your-domain`, no path), restart `web`, then check `https://your-domain/robots.txt` lists a `Sitemap:` line and submit `https://your-domain/sitemap.xml` in Google Search Console and Bing Webmaster Tools. Keep the reverse proxy redirecting `http` and any `www`/non-`www` alias to this one origin (the app cannot do that itself) and update `server_name` in `apps/nginx/nginx.conf` to match.

## Security notes

- Both app containers run as a non-root user (`nextjs` in the web image,
  `worker` in the worker image) — everything except the one-off migration
  command above.
- Put a reverse proxy (Caddy, nginx, Traefik) in front of `web` for TLS.
  Zendesk and Jira webhooks, and the OAuth redirect flows, all require
  HTTPS in practice.
- `web` is published on `127.0.0.1:3000` only (`WEB_BIND`), so the proxy is
  the only way in. If you set `WEB_BIND=0.0.0.0` because the proxy runs on
  another host, firewall the port to that host. A client that reaches `web`
  directly can forge `X-Forwarded-For`.
- The proxy must append the connecting address to `X-Forwarded-For`. Caddy
  and Traefik do this by default; in nginx use
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` along with
  `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Proto $scheme;`.
  The app reads the client IP from the right end of that header, skipping
  `TRUSTED_PROXY_COUNT - 1` entries (default `1`). Set it to `2` if a CDN or
  load balancer sits in front of your proxy. Too low and every visitor
  shares the CDN's rate-limit bucket; too high and clients can spoof their
  IP again.
- `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`,
  `SMTP_ENCRYPTION_KEY`, and `INTEGRATION_TOKEN_ENCRYPTION_KEY` are four
  independent secrets by design — see the table above and the comments on
  each in `.env.example`. Back them up with the database, but store them
  separately (see [Backups](#backups)): losing any of them makes the data
  it encrypts unrecoverable, not just un-decryptable-until-fixed.
- `.env.prod` is never committed. It was tracked in this repository until
  roadmap step 39, so every value in any copy of it from before then must
  be treated as leaked — **rotated 2026-09-19** (see
  [Rotating secrets](#rotating-secrets)).
- Basic rate limiting and webhook replay protection (roadmap step 30) are
  in place: `/api/sign-up`, `/api/auth/callback/credentials`, and
  `/api/webhooks/**` are throttled per client IP in `apps/web/src/proxy.ts`
  (in-memory, since this stack runs a single `web` container — see the
  reverse-proxy note above for where the client IP comes from), and both
  webhook receivers reject stale payloads via a timestamp check alongside
  their existing secret verification.
- Jira webhook secrets (roadmap step 43): new Jira webhooks put the
  integration's secret in Jira's own **Secret** field, and Jira signs each
  delivery (`X-Hub-Signature`, HMAC-SHA256 of the body). Nothing secret is
  in the URL. Webhooks set up before this step use a URL ending in
  `?secret=…`, which still works but ends up wherever request URLs are
  logged. The app strips it from Sentry events. Your reverse proxy's
  access log is yours to handle: either have those customers move the
  secret into the Secret field (the Jira settings card explains how), or
  don't log query strings for `/api/webhooks/jira/*`. In Caddy, the
  default access log is off unless you add `log`; if you use it, filter
  the field with
  `log { format filter { request>uri query { delete secret } } }`.
  In nginx, use a `log_format` that logs `$uri` instead of `$request` or
  `$request_uri` for that location.
- Security headers and CSRF hardening (roadmap step 33): every response
  carries a CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  a `Referrer-Policy`, and, in production, HSTS (see
  `apps/web/security-headers.mjs`). HSTS only takes effect once the reverse
  proxy serves the app over HTTPS. State-changing `/api/**` requests (all
  except webhooks and NextAuth's own endpoints) must send an `Origin`
  matching `NEXTAUTH_URL` or the forwarded host, or they get `403`. Make sure
  `NEXTAUTH_URL` is the exact public origin, and that the reverse proxy
  forwards `Host` or sets `X-Forwarded-Host`.

### Rotating secrets

Rotate when a secret may have leaked (for example, `.env.prod` ended up in
git, a chat, or a shared drive), or when someone with access leaves.

**Rotation log**

| Date | Reason | Scope | Method |
| --- | --- | --- | --- |
| 2026-09-19 | `.env.prod` was tracked in git from `1ec4936` (2026-09-14) to `23c06cb` (2026-09-17); every value in that history must be treated as leaked (roadmap step 0.4). | `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY` | `scripts/rotate-secrets.sh --apply-to-db .env.prod` |

```bash
scripts/backup.sh
scripts/rotate-secrets.sh --apply-to-db .env.prod
docker compose -f docker-compose.yml --env-file .env.prod up -d
```

Know what each rotation costs before running it:

| Secret | What happens when it changes |
| --- | --- |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | Postgres only reads `POSTGRES_PASSWORD` when it first creates its volume. For an existing database, `--apply-to-db` runs `ALTER USER` in the running `postgres` container before the file is rewritten. Without that flag, web and worker can't connect after the restart. If you use a managed database, change the password there and update `DATABASE_URL` yourself. |
| `NEXTAUTH_SECRET` | Every user is signed out. Nothing is lost. |
| `INTEGRATION_CONFIG_ENCRYPTION_KEY` | Every saved integration OAuth client secret becomes unreadable (`IntegrationConfigUnreadableError`), and each organization must re-enter it under **Settings → Integrations → Configure**. There's no re-encryption path. |
| `SMTP_ENCRYPTION_KEY` | Every saved SMTP password becomes unreadable, and each organization must re-enter it under **Settings → Notifications**. |

The script keeps the previous file as `.env.prod.before-rotate-<timestamp>`
(owner-only, gitignored). Delete it once the stack is healthy. Dumps taken
before the rotation still hold ciphertext for the old encryption keys, so
restoring one also needs that old `.env.prod`.

The script can't rotate third-party credentials. Revoke and replace these with
their provider, then edit `.env.prod`: `DEPLOYMENT_SMTP_PASSWORD` (for Gmail,
delete the app password in your Google account and create a new one),
`OPS_ALERT_SLACK_WEBHOOK_URL`, and `SENTRY_DSN`.

## Running multiple workers

Any number of worker containers can run against one database. They do not
elect a leader or take turns: every worker processes organizations, and they
split the organizations between them through the database.

Scale with the `worker` service's replica count:

```bash
WORKER_REPLICAS=3 docker compose --env-file .env.prod up -d
# or, equivalently for a running stack:
docker compose --env-file .env.prod up -d --scale worker=3
```

Add a container (or roll a new image) at any time; nothing needs to be
reconfigured or stopped. Each replica takes a unique `WORKER_ID` automatically
(`hostname:pid:random`), which is what appears in logs and in
`organization_work_states.leaseOwner`. The service intentionally has no
`container_name` and no published port, since either would stop a second
replica from starting.

**How work is divided.** Every organization has one row in
`organization_work_states` holding when its next active poll and its next
reconciliation are due. A worker claims due organizations in a single
statement (`FOR UPDATE SKIP LOCKED`), so two workers can never be handed the
same organization. The claim is a *lease* with a fencing token:

- the holder renews it while it works (every `WORKER_LEASE_TTL_MS / 3`);
- it is the only process that ingests that organization's provider data, which
  is what keeps two workers from racing on an integration's sync cursor;
- before publishing results and before sending notifications it checks, against
  the database row, that it still holds the current token, so a worker that
  stalled past its lease and was replaced stops instead of writing stale
  results (and its completion is rejected by the database);
- if a worker crashes, its leases lapse after `WORKER_LEASE_TTL_MS` (default
  60 s) and other workers take the organizations over; a graceful stop releases
  them immediately.

Organization-level processing is still serialized per organization by the
existing advisory lock, so webhook deliveries and the onboarding backfill keep
working exactly as before.

**Cadence.** Active polling is scheduled start-to-start per organization
(`WORKER_ACTIVE_POLL_MS` or the Monitoring setting): an organization is due one
interval after its last run *started*; a run that takes longer than the
interval is followed immediately by the next, never by a burst. A
reconciliation pass is due at most 30 minutes after the previous one started
(30 minutes is the maximum; a larger saved value is capped), it is claimed ahead
of an active poll when both are due, and a reconciliation that falls due while
an active run is in progress runs as soon as that run finishes. More workers
raise throughput across organizations; they do not make a single slow provider
request faster.

**Settings.**

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_REPLICAS` | `1` | Compose only: number of worker containers. |
| `ORGANIZATION_CONCURRENCY` | `3` | Organizations one worker processes at once. Total parallelism is this times the replica count. |
| `WORKER_LEASE_TTL_MS` | `60000` | How long a crashed worker's organizations stay unavailable. Shorter recovers faster but tolerates less pause (GC, network blip) before a healthy worker is considered gone. |
| `WORKER_CLAIM_POLL_MS` | `1000` | Longest an idle worker sleeps between claim attempts; also how quickly a brand-new organization is picked up. |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000` | How long a stopping worker lets in-flight organizations finish before releasing their leases. Keep `stop_grace_period` in `docker-compose.yml` above it. |
| `WORKER_DATABASE_POOL_MAX` | `2 × concurrency + 4` | Compose name for the per-worker `DATABASE_POOL_MAX`. |
| `WORKER_LOCK_RETRY_MS`, `WORKER_LOCK_PING_MS` | `15000`, `30000` | Only the watchdog election (below). |

**Connection budget.** The Prisma pool is per process, so connections add up
across replicas. Per worker: the pool (`2 × ORGANIZATION_CONCURRENCY + 4`,
10 at the default) plus one held for the watchdog election plus one short-lived
connection per organization in flight (`ORGANIZATION_CONCURRENCY`) — 14 at the
defaults. Add the web app's pool (20 by default). Postgres's default
`max_connections` is 100, which fits roughly five workers next to the web app;
raise `max_connections` (or lower the pool sizes) before going beyond that. The
health endpoint reports each worker's pool size.

**What is still a singleton.** A session-level Postgres advisory lock now only
elects the one worker that runs the stalled-work watchdog (which would
otherwise page twice). Losing that election is harmless to processing: the
worker keeps working and retries every `WORKER_LOCK_RETRY_MS`; if the holder
dies, another worker's next retry takes it.

**Known limits.** A manual *Sync now* / onboarding backfill started from the web
app ingests a provider outside the worker lease, exactly as before, so it can
still overlap a worker's poll of the same organization; both paths are
idempotent, and the window is a single user-initiated run. A lease protects
against a *stalled* worker, not one that keeps running after its lease was
taken: it is stopped at the next check (between stages, and before anything
irreversible), so at most the provider call in flight at that moment completes.

## Health checks and observability

- **`GET /api/health`** (web) checks database connectivity only —
  `SELECT 1` through Prisma — and is deliberately unauthenticated (see
  `apps/web/src/proxy.ts`) so an uptime monitor or orchestrator can call it
  with no session. Returns `200 {"status":"ok",...}` or `503
  {"status":"error",...}`.
- **`GET /health`** (worker, `WORKER_HEALTH_PORT`, default `8081`) is a
  plain `node:http` listener — the worker had no HTTP surface at all before
  this. Returns the same `running`/`degraded`/`stopped` status the
  Monitoring settings page already derives from `WorkerSettings`
  (`degraded` means the process is alive but an organization's latest run
  recorded failures; `stopped` means no heartbeat at all, i.e. the worker
  cannot reach the database), plus this worker's own state (`worker.id`,
  `worker.loop` claim/completion/lease-loss counters, pool size), the
  deployment-wide per-organization schedule (`workState`: organizations,
  leased, expired leases, overdue active/reconciliation counts and the lag of
  the most overdue one), `lastSuccessfulCycleAt` and an
  aggregate `integrations.mostRecentSyncAt`/`withErrors` across every
  connected integration. Responds `503` only for `stopped`, since that's
  the one case an orchestrator restart can actually fix. Not published to
  the host by `docker-compose.yml` — only the container's own
  `HEALTHCHECK` (and Docker's resulting restart-on-unhealthy behavior with
  `restart: unless-stopped`) uses it; add your own `ports:` mapping if an
  external monitor should poll it directly. Every worker answers for itself
  (there is no standby): `503 {"status":"starting"}` until its work loop is
  running and `503 {"status":"stalled"}` if that loop stops making progress.
- **Error tracking**: set `SENTRY_DSN` to enable
  [Sentry](https://sentry.io) (or any Sentry-protocol-compatible service)
  in both apps — unhandled exceptions in either app, every per-integration
  `Integration.lastSyncError` (excluding routine reauth-required errors,
  which the settings UI already surfaces), and each worker cycle's own
  uncaught failure. Leaving it unset disables the SDK outright with no
  other effect.
- **Sentry source maps** (web only): to get readable stack traces, set
  `SENTRY_AUTH_TOKEN` (scopes `project:releases` and `org:read`),
  `SENTRY_ORG` and `SENTRY_PROJECT` in `.env.prod` — and `SENTRY_URL` for
  self-hosted Sentry — then rebuild the image
  (`docker compose --env-file .env.prod build web`). `next build` uploads the
  maps, matched to the running code by debug ID, and deletes them from the
  build output. If any of the three is blank nothing is uploaded and the
  build is unchanged. The values are build args of the builder stage only, so
  the token is not in the final image (it does appear in the build cache's
  metadata on the build host — treat that host accordingly). The worker's
  stack traces are not source-mapped.
- **Stalled-cycle alerting**: the worker elected as watchdog checks the
  per-organization schedule every two minutes and, if any organization's
  active poll or reconciliation is more than two intervals overdue (the
  same "3x its configured interval" threshold, now per organization), sends
  an alert — to you, the deployment owner, not
  your customers — through whichever of `OPS_ALERT_SLACK_WEBHOOK_URL`
  (a plain Slack incoming-webhook URL) or `OPS_ALERT_EMAIL` (sent through
  the shared `DEPLOYMENT_SMTP_*`) is configured; both, either, or neither is
  fine. A recovery is announced the same way once the cycle catches up. This only
  catches a worker that's alive but not completing cycles — a fully
  crashed process stops this check along with everything else, which is
  what the `HEALTHCHECK`/restart policy above is for instead.

## Image notes

- **web** builds with Next.js's `output: "standalone"`
  (`apps/web/next.config.mjs`), so the runtime image ships only the traced
  server bundle and pruned `node_modules` — none of the pnpm workspace or
  devDependencies.
- **worker** has no equivalent bundling step: `apps/worker`'s own `start`
  script runs its TypeScript directly via `tsx` rather than a compiled
  `dist/`, and every `@sla/*` package it imports is consumed as workspace
  TypeScript source (each package's `main` points at `src/index.ts`, not a
  build artifact). The worker image therefore keeps the full monorepo
  install, including devDependencies — there's no way to slim it down
  without changing how the package is run, which is out of scope here.
- Neither image needs Prisma query-engine binaries or `libssl`/OpenSSL —
  `packages/db` generates Prisma's driver-adapter client
  (`@prisma/adapter-pg`), which is pure JS/TS with no native engine, so
  plain `node:22-alpine` is enough for both.
