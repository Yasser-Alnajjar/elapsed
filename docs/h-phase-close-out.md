# Production Hygiene close-out: security record and accepted limitations

This is the closure record for the Production Hygiene items (H-1 to H-13) that left a security procedure, an accepted limitation or a standing finding behind. Everything that was only history (owner-action lists, release plans, the N1 readiness check, the Sentry and lint procedures, the per-ticket H-4 tables) was removed in the 2026-10-16 documentation cleanup and is in git history at commit `930c4ff`. The decisions and open work live in [`implementation-plans/ROADMAP_Product.md`](../implementation-plans/ROADMAP_Product.md).

## Final state of every H item

| ID | Item | Final state |
| --- | --- | --- |
| H-1 | Provider pair and status per live tenant | **Closed 2026-09-30, accepted limitation** ([below](#h-1--provider-pairs-per-tenant)) |
| H-2 | D14 pricing decision | Closed 2026-10-05: live model Starter $49, Team $149, Enterprise Custom (`PLANS`); the obsolete `$299/$699` and the Phase-18 escalation pricing are not adopted |
| H-3 | Pricing-page false claims | Done |
| H-4 | Engine vs Zendesk on live tenants | **Closed 2026-09-30, accepted limitation** ([below](#h-4--live-tenant-spot-check)) |
| H-5 | Retention / on-call note | Done (`data-retention-and-on-call.md`); the organization-deletion rehearsal and host deployment remain open owner items |
| H-6 | Sentry source maps | Closed 2026-10-16 as obsolete: Sentry was removed (Decision 7) |
| H-7 | Capacity limits | Done on dev hardware (`capacity-limits.md`); production host not measured |
| H-8 | Lint step | Permanently dropped by the owner 2026-10-16 (Decision 10) |
| H-9 | Live onboarding walkthrough | **Closed 2026-10-12 on the owner's confirmation** ([below](#h-9--live-onboarding-walkthrough)) |
| H-10 | Launch-Gate security items on production | **Closed 2026-10-16** ([below](#h-10--production-security-verification)) |
| H-11 | First Response start actor | Closed 2026-09-29; code fixed and the production repair applied (7 false commitments deleted, 0 notifications had been sent, ticket 1 recreated) |
| H-12 | Pending pause decision | Done: D30, imported Zendesk policies never pause on Pending |
| H-13 | `breachedAt` disagreements | Closed 2026-10-10 as resolved or moot (an owner-run query found 0 breached evaluations with a NULL `breachedAt`); not a confirmed production backfill |

## H-1 — provider pairs per tenant

**Closed 2026-09-30 by owner decision, with an accepted limitation.** Evidence (`scripts/prod/h1-provider-pairs.sql`, run read-only on the host's application database): 12 tenants, all Zendesk + Jira and connected, none with an unhealthy integration, none with Intercom, Linear or GitHub; 1,508 cases (min 45, median 133, max 133). **Limitation:** 11 of the 12 organizations are `seed-org-*` fixtures written by `seed-test-customers`; the other is the dev Zendesk sandbox tenant. The real 10-customer dataset was **not queried or verified**, and the case-size figures are fixture artifacts. "No tenant has both Zendesk and Intercom" is an assumption for the real customers; if one is found with another pair, redo the replay classification for it. D15 stays unverified. On this host the application database is `elapsed_db` (not `$POSTGRES_DB`) and the env file is `.env`.

## H-4 — live-tenant spot check

**Closed 2026-09-30 by owner decision, with an accepted limitation.** The live export (`packages/db/src/scripts/h4-live-export.ts`, read-only, GET-only Zendesk) and `scripts/h4-compare/compare-live.py` compared the engine with Zendesk's own SLA view on the host's one non-fixture organization (the dev sandbox): 45 tickets; 33 match, 7 semantic, 13 data, 18 initially unexplained. **All 18 were explained; none is an engine defect:** 12 Resolution elapsed differences were the Pending pause (H-12 / D30); 4 First Response target rows were D5b on agent-submitted tickets; ticket 27 is the documented reverse Next Reply case; ticket 1 was the H-11 shape (repaired); ticket 45 and the data rows were a since-deleted sandbox policy (Elapsed backfills against the current policy, not the one Zendesk applied then).

**Documented semantic (owner, 2026-09-30):** when an agent replied before the customer's first message on an agent-submitted ticket, that message opens both a First Response (D5b) and a Next Reply obligation; Zendesk opens one. It is deliberate in the code (`findFirstResponseEvent` is called without the D5b start bound for cycle derivation) and is not an engine defect. Revisit if customers report duplicate reply alerts.

**Limitation, accepted:** the run covers **one** tenant with 0 open commitments and a 24/7 calendar. **Not covered:** business hours, holidays, DST, open commitments and at-risk state, legs, and any live customer tenant. A difference specific to those areas would first surface in a replay or in production.

**Side observation, never investigated:** in the dev data, a Resolution commitment stored a *breached* evaluation (11:15:21) and then ended *met* (11:17:13) because the worker evaluated before the solve had been ingested. If such an evaluation triggers an alert, a customer could see a breach alert for a met ticket. Whether alerts can fire in that window is unchecked.

## H-9 — live onboarding walkthrough

**Closed 2026-10-12 on the owner's explicit confirmation, not on independently recorded evidence.** The owner states the live walkthroughs for Zendesk, Intercom and Linear (real OAuth round trips) and the live Intercom link capture were completed, several times, before that date and were not documented. No dates, pairs, timings, hesitations, errors, counts or account details were recorded, and none are inferred. Nothing was re-run.

## H-10 — production security verification

**Closed 2026-10-16.** Acceptance: leaked secrets rotated; no development services in production; authorization audit current; tenant isolation covers every model. Host verification `38 PASS, 0 FAIL, 1 MANUAL` (04:40 UTC); the MANUAL line (the encryption keys) is decided below.

### The one verification command

`scripts/prod/h10-verify.sh` is the single source of verification (ledger C-15). Run it from a workstation:

```bash
ssh -i KEY ubuntu@13.62.74.24 'cd ~/elapsed && bash -s' < scripts/prod/h10-verify.sh | tee h10-$(date -u +%F).txt
```

It uses the host's env file (`.env.prod` if present, else `.env`; on the host it is `.env`), prints one `PASS` / `FAIL` / `MANUAL` line per check and a summary, never prints a value, **refuses to run under `bash -x`** (xtrace prints every variable assignment), opens the database read-only, and gives every docker/psql call a timeout (`H10_TIMEOUT`, 30 s). A check that cannot run is `FAIL ... not verified`, never `PASS`. Exit status: 0 all PASS, 1 any FAIL, 3 only MANUAL left.

| Section | What it proves |
| --- | --- |
| 1 | No value from the public `.env.prod` history (`1ec4936`, `c3393fa`, `af08635`) is still in use, compared by name **and under any other name**. |
| 2 | `NEXTAUTH_SECRET` and the three encryption keys are set and pairwise distinct; `DATABASE_URL` carries `POSTGRES_PASSWORD`. |
| 3 | In the database named by `DATABASE_URL` (`elapsed_db` on the host; **not** `POSTGRES_DB`, which names an empty database there): migrations are applied, the credential columns exist, and 0 values are stored outside their ciphertext format (`enc:v1:` for integration tokens, custom secrets, Slack tokens; unprefixed AES-GCM for `integration_configs.clientSecret` and `organization_email_settings.password`). |
| 4 | Only `postgres`, `web`, `worker`, `nginx` run; only nginx publishes a host port; `web` and `worker` run `NODE_ENV=production`; no dev listeners on 5432/3000/3001/5555/9229/1025/8025; no seed data. |
| 5 | The running `web` and every `worker` use the env file's `DATABASE_URL` (and `web` its `NEXTAUTH_SECRET`); health endpoints answer; the retired `OPS_ALERT_SMTP_PASSWORD` is in no container; the database accepts `POSTGRES_PASSWORD` and refuses a wrong one. |
| 6 | One `MANUAL` line: the encryption-key decision. |

### Exposed credentials and the rotation plan

1. **Public git history (the repository has been public since 2026-09-14).** The values in `1ec4936`, `c3393fa`, `af08635` are public. The 2026-09-19 rotation covered `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY`, `SMTP_ENCRYPTION_KEY`; the host check confirms none of them, nor any other current secret, equals a leaked value. **`OPS_ALERT_SMTP_PASSWORD` is retired:** the SMTP configuration was consolidated into `DEPLOYMENT_SMTP_*` and `OPS_ALERT_EMAIL`; the variable is absent from `.env`, the Compose environment and every container, and the leaked value is not reused under any name. Provider-side revocation of the old password was not verified and is not required while nothing shows it is still active. `SENTRY_DSN` is out of scope (Sentry removed). `INTEGRATION_TOKEN_ENCRYPTION_KEY` was never in the leaked file.
2. **An earlier traced (`bash -x`) run of the script** exposed the then-current `POSTGRES_PASSWORD`, `DATABASE_URL`, `NEXTAUTH_SECRET` and the three encryption keys. **Rotated 2026-10-16:** `POSTGRES_PASSWORD`/`DATABASE_URL` and `NEXTAUTH_SECRET`. **Not rotated:** the three encryption keys. Delete any terminal log or transcript that holds the traced output.

**Do not run `scripts/rotate-secrets.sh` for this.** It rotates all three encryption keys at once, which makes every stored integration token, OAuth client secret, SMTP password and custom-source credential unreadable (every tenant must reconnect), and its default compose file (`docker-compose.prod.yml`) no longer exists.

**Encryption keys: decided 2026-10-16, option A.** Not rotated; the residual risk is accepted until a re-encryption tool exists (roadmap N8-S7). The app has no re-encryption path: integration tokens and custom secrets use `INTEGRATION_TOKEN_ENCRYPTION_KEY`, OAuth client secrets `INTEGRATION_CONFIG_ENCRYPTION_KEY`, organization SMTP passwords `SMTP_ENCRYPTION_KEY`, and a new key makes old ciphertext unreadable. An attacker needs both a key and the database ciphertext; the exposed database password is rotated and PostgreSQL publishes no host port. Keep backups access-restricted. Alternatives not taken: build a dual-key re-encrypt command first (B), or rotate now and have every organization reconnect (C).

**Rotating the database password and session secret** (done 2026-10-16; kept for future rotations). The owner runs this on the host; it signs every user out once, prints no value, changes no data, and must not run under `set -x`:

```bash
cd ~/elapsed && umask 077 && cp .env .env.bak-$(date -u +%F)
NEW_PG=$(openssl rand -hex 24); NEW_NA=$(openssl rand -base64 32)
APP_ROLE=$(sed -nE 's#^DATABASE_URL="?[a-z]+://([^:@/]+)[:@].*#\1#p' .env)
printf "ALTER ROLE \"%s\" PASSWORD '%s';\n" "$APP_ROLE" "$NEW_PG" | docker compose exec -T postgres sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' && \
NEW_PG="$NEW_PG" NEW_NA="$NEW_NA" perl -i -pe 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$ENV{NEW_PG}/; s#^(DATABASE_URL="?[a-z]+://[^:@/]+:)[^@]*@#$1$ENV{NEW_PG}\@#; s/^NEXTAUTH_SECRET=.*/NEXTAUTH_SECRET="$ENV{NEW_NA}"/' .env && \
docker compose up -d --no-deps --no-build web worker
unset NEW_PG NEW_NA APP_ROLE
```

`--no-deps --no-build` recreates only `web` and `worker` with the deployed images: no rebuild, no `migrate` run. **Update `.env` and recreate `web`/`worker` in the same step:** on 2026-10-16 a rotation whose `DATABASE_URL` still carried the old password took production down (`/api/health` 503, `web` unhealthy, workers not running) until the owner corrected it. Check health, then re-run the verification command. If `ALTER ROLE` fails, `.env` is left unchanged; roll back with `.env.bak-*` plus `ALTER ROLE` to the old password, and delete `.env.bak-*` once healthy (it holds the exposed values). Add one row per rotation to the rotation log in `docs/deployment.md` (date, reason, scope, method; no values).

### H-10 closure record

| # | Action | State |
| --- | --- | --- |
| 1 | Host verification with no FAIL | Done 2026-10-16 04:40 UTC: `38 PASS, 0 FAIL, 1 MANUAL` |
| 2 | Database password and `NEXTAUTH_SECRET` rotation | Done 2026-10-16, verified by section 5 and the refused old password |
| 3 | Encryption-key decision | Decided 2026-10-16: option A, keys not rotated |
| 4 | Leaked ops SMTP password | Retired 2026-10-16 (not reused under any name); provider-side revocation not verified, not required |
| 5 | Seed-fixture organizations in production | 0 seed rows out of 26 checked; 1 organization (the 10-customer count is unreconciled, OD-07) |
| 6 | Re-audit of the 28 routes added since the 71-route audit | Decided 2026-10-16 (OD-12): no re-audit; the 2026-09-29 audit and `tenant-scope-classification.test.ts` stand as current |

## H-10 code audit: mutation routes and tenant isolation

Done 2026-09-29, no production access. Scope: every `route.ts` under `apps/web/src/app/api` (71 at the time), server actions (none exist) and mutations outside the API layer (none; writes go through `@sla/db` / `@sla/commitments` helpers).

| Family | Authentication | Organization comes from |
| --- | --- | --- |
| `settings/*` mutations; `integrations/*` connect/callback/disconnect/backfill/config POST | session + `requireOwner` | the session, never the body; policy, calendar, customer, invitation and member ids are re-checked with an organization-scoped lookup before any write |
| `settings/*` and other GETs | session (any member) | the session |
| `me/*` | session + current-password re-entry, throttled | the session's own user id |
| `concierge/*` | session | the session, then `authorizeSourceExport` re-checks that the integration belongs to the organization (cross-org gets 404) |
| OAuth callbacks | session + owner + HMAC-signed state bound to organization, user and a cookie | the signed state |
| `settings/worker` | session + platform operator | global settings by design |
| Webhooks (Zendesk, Jira) | shared secret, timestamp freshness | the integration row; secret verified before any work |
| `password-reset`, `email-verification`, `invitations/accept`, `sign-up` | public; single-use hashed tokens claimed atomically | the token's own row |

`getServerSession` re-checks the user row and `sessionVersion` on every request, so member removal and password changes take effect immediately. Tests: `apps/web/test/tenant-isolation.test.ts` (real Postgres), `tenant-scope-classification.test.ts` (fails for any model without a tenant path or without isolation seeding), `packages/email/test/destination.test.ts`, `apps/web/test/csv-formula-injection.test.ts`.

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-A | High | The role was baked into the JWT; `updateMemberRole` did not bump `sessionVersion`, so a demoted owner kept owner powers for up to 30 days. | **Fixed** (`packages/db/src/members.ts` bumps `sessionVersion`). |
| F-D | Medium | The email test/send routes connected to an owner-supplied host with no destination check, and a blank password fell back to the saved password whatever host was typed. | **Fixed:** a blank password applies only while host and username equal the saved ones; `@sla/email` refuses non-public destinations (resolves the host, refuses when ANY address is non-public, connects to the resolved address with the typed name as TLS servername). `SMTP_ALLOW_PRIVATE_HOSTS=1` is the local escape hatch. |
| F-G | Low–medium | The CSV writer did not neutralize text cells starting with `=`, `+`, `-`, `@` (or tab/CR). | **Fixed** at the single choke point (`packages/core/src/csv.ts`); number cells and the app's own overdue durations are exempt. |
| F-E | Info | `LegSpan` is never read or written (legs are derived in memory). | Noted; candidate for removal. |
| F-H | Info | `operator-monitoring-data` reads `NotificationFailure` across all organizations by design. | Intended. |
| F-I | Info | The webhook returns 404 for an unknown integration id and 401 for a wrong secret, so a valid id can be distinguished (ids are unguessable cuids). | Accepted. |

**Not audited:** business logic of the pipelines (not request-driven), the marketing pages, `apps/concierge`, and rate limiting (in-memory, per instance, N8-S5). Not addressed on purpose: SMTP port allow-listing and a certificate pin for organization SMTP.
