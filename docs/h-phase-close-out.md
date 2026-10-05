# Production Hygiene close-out (H-1 to H-12)

> **Summary (2026-09-30).** **H-1 and H-4, the two entry conditions for N1, are CLOSED** by owner decision, each with an accepted limitation recorded below (H-1: the host's data is mostly test fixtures, the real customers were not verified; H-4: one tenant, the dev sandbox, not two live tenants). **N1 is unblocked.** Closed or accepted: H-1, H-3, H-4, H-5, H-7, H-11, H-12, and (2026-10-05) H-2, since D14 is decided. **Still open, and none of them gates an N-phase:** H-6 (Sentry credentials), H-8 (blocked upstream), H-9 (Zendesk sandbox walkthrough), H-10 (host verification and third-party rotation).

**Prepared:** 2026-09-29. Everything below that could be done without production access or your decisions has been done and is listed under "Ready". What is left needs you, and each step says exactly what to run. **Nothing here touches production until you run it.** All production commands are read-only except where marked.

## Status of every H item

| ID | Item | Status | What closes it |
| --- | --- | --- | --- |
| H-1 | Provider pair and status per live tenant | **CLOSED 2026-09-30, accepted limitation.** 12 tenants, all Zendesk + Jira, all connected; 11 are `seed-org-*` fixtures, the real 10-customer data was not verified | [H-1 record](#h-1--provider-pairs-per-tenant) |
| H-2 | D14 pricing decision | **CLOSED 2026-10-05.** D14 is decided (live seat-based model: Starter $49, Team $149, Enterprise Custom) and built as `PLANS`. Which plan each customer pays on is data entry, tracked as roadmap N4.7 | [H-2 record](#h-2--d14-closed) |
| H-3 | Pricing-page false claims | **Done** (already checked) | — |
| H-4 | Engine vs Zendesk on live tenants | **CLOSED 2026-09-30, accepted limitation.** Export and comparison run on one tenant (the dev sandbox); all 18 UNEXPLAINED rows explained; not two live tenants | [H-4 record](#h-4--live-tenant-spot-check) |
| H-5 | Retention / on-call note | **Done** (already checked). Two of its findings are still open, see [Findings from this pass](#findings-from-this-pass) | — |
| H-6 | Sentry source maps on the host | **Needs production access** and Sentry credentials from you | [H-6 procedure](#h-6--sentry-source-maps) |
| H-7 | `perf:baseline` re-run and capacity limits | **Done** in the roadmap's terms (measured; dev hardware, stated as such) | [`capacity-limits.md`](capacity-limits.md) |
| H-8 | Lint step | **Blocked upstream**; a workaround needs your decision | [H-8](#h-8--lint-step) |
| H-9 | Live onboarding walkthrough | **Needs you** (Zendesk sandbox OAuth), checklist prepared | [H-9 checklist](#h-9--live-onboarding-walkthrough) |
| H-10 | Launch-Gate security items on production | **Needs production access**; script prepared and tested; one real gap found | [H-10 procedure](#h-10--production-security-verification) |
| H-11 | First Response start actor | **CLOSED 2026-09-29.** Code fixed; production repair applied and verified (7 false commitments deleted, 0 notifications sent, ticket 1 recreated) | [Deploy-time steps](#deploy-time-steps-from-h-11-and-h-12) |
| H-12 | Pending pause decision (D30) | **Done** (already checked). Customer notice before deploy | [Deploy-time steps](#deploy-time-steps-from-h-11-and-h-12) |

Dependencies between H items: H-4 needs H-1 only to choose tenants (the SQL in H-4 can pick them without H-1). H-9 is independent. H-10 is independent. **N1's own entry gate is H-1 and H-4.** Nothing else here blocks N1 (the roadmap says so; this pass found nothing that changes that, see [N1 readiness](#n1-readiness)).

## Ready to commit (nothing committed yet)

| File | What it is |
| --- | --- |
| [`docs/capacity-limits.md`](capacity-limits.md) | H-7 measured capacity and stated limits |
| [`scripts/prod/h1-provider-pairs.sql`](../scripts/prod/h1-provider-pairs.sql) | H-1, read-only, counts only, validated against the dev database |
| [`scripts/prod/h4-pick-tenants.sql`](../scripts/prod/h4-pick-tenants.sql) | H-4 tenant chooser, read-only, validated |
| [`packages/db/src/scripts/h4-live-export.ts`](../packages/db/src/scripts/h4-live-export.ts) | H-4 export (read-only DB, GET-only Zendesk, allow-listed fields). **Not run against Zendesk**: see the note under H-4 |
| [`scripts/h4-compare/compare-live.py`](../scripts/h4-compare/compare-live.py) | H-4 offline comparer; tested on a synthetic fixture (match, open-due mismatch, missing first response, transient breach) |
| [`scripts/prod/h10-verify.sh`](../scripts/prod/h10-verify.sh) | H-10 host checks; the secret-history logic tested with a synthetic env file |
| [`apps/web/test/tenant-scope-classification.test.ts`](../apps/web/test/tenant-scope-classification.test.ts) | H-10 guard: every Prisma model must declare its tenant path (28 tests pass) |
| `apps/worker/scripts/perf-baseline-cycle.ts` | `PERF_ORG_ID` now accepts a comma-separated list |
| this file | the runbook |

## Findings from this pass

1. **H-10, a real gap.** The `.env.prod` that was committed (`1ec4936`, `c3393fa`, `af08635`, all on `origin`) also held `SENTRY_DSN`, `OPS_ALERT_SMTP_USER`, `OPS_ALERT_SMTP_HOST` and **`OPS_ALERT_SMTP_PASSWORD`** with real-length values. The 2026-09-19 rotation log in `docs/deployment.md` lists only `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `INTEGRATION_CONFIG_ENCRYPTION_KEY` and `SMTP_ENCRYPTION_KEY`. `scripts/rotate-secrets.sh` cannot rotate third-party credentials, so unless you replaced the ops SMTP password at its provider, it is still the leaked one. (Found by reading key names and value lengths only; no value was printed.) `INTEGRATION_TOKEN_ENCRYPTION_KEY` did not exist in the leaked file, so it needs no rotation for that reason.
2. **H-7, a real limit.** `/dashboard` still loads every event of every case with a commitment (185k events at 5k cases, 370k at 10k; 1.9–2.6 s and 3.5 s). Performance-plan Phase 2 expected 0 events. Details and numbers in `capacity-limits.md`. Not fixed here; proposed follow-up only.
3. **H-4 side observation.** In the dev data, ticket 54's Resolution commitment stored a *breached* evaluation (11:15:21) and then ended *met* (11:17:13): the ticket was solved at 11:14:47, before its due time, but the worker evaluated before the solve had been ingested. The comparer counts these as "transient breaches". If such an evaluation triggers an alert, the customer sees a breach alert for a met ticket. Whether alerts fire in that window is worth checking; not investigated further here.
4. **From H-5, still open:** `docker-compose.prod.yml` was deliberately removed and production runs the root `docker-compose.yml` (the H-10 and H-1/H-4 commands here use it; older runbook text may still say `.prod.yml`), and organization delete is impractically slow without an index on `normalized_events.sourceRawEventId`.
5. **H-10 tenant isolation and mutation audit: done, see [H-10 code audit](#h-10-code-audit-mutation-routes-and-tenant-isolation).** One privilege bug found and fixed; four smaller findings reported.

## H-1 — provider pairs per tenant

> **CLOSED 2026-09-30 by owner decision, with an accepted limitation.**
> - **Evidence** (`scripts/prod/h1-provider-pairs.sql`, run read-only on the host's application database): 12 tenants; provider pair **12 × Zendesk + Jira**, all connected; 0 with an unhealthy integration; 0 without a connected integration; no tenant with Intercom, Linear or GitHub. Cases: total 1,508, min 45, median 133, max 133.
> - **Limitation, stated plainly:** 11 of the 12 organizations are `seed-org-*` fixtures written by `seed-test-customers`. That is known test/fixture data, **not production customer evidence**. The other organization is the dev Zendesk sandbox tenant. **The real 10-customer dataset was not queried or verified**, and the case-size figures are fixture artifacts, not live tenant sizes.
> - **Accepted risk:** the acceptance below ("the 10 live tenants") cannot be truthfully met from this host, so the item is closed on this evidence so N1 is not blocked. "No tenant has both Zendesk and Intercom" is an **assumption** for the real customers; if one is later found with another pair, redo N1.2's classification for it. D15 stays unticked.
>
> The procedure below is kept for reference. Note that on this host the compose flags are `docker compose exec ...` with the default `.env` and the database is `elapsed_db`, not `$POSTGRES_DB`.

**Acceptance (roadmap):** the provider pair and integration status of each of the 10 live tenants recorded as **counts per pair** in the Status Board, never customer names.

Run on the production host (read-only; prints no names or ids):

```bash
docker compose -f docker-compose.yml --env-file .env.prod exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f -' \
  < scripts/prod/h1-provider-pairs.sql
```

Paste the three result tables to me. I will put the counts in the Status Board, resolve the data half of D15, and tick H-1. Note the roadmap's own caveat: you deferred H-1 because production database access was not being requested; this is the smallest access that closes it (three SELECTs).

## H-4 — live-tenant spot check

> **CLOSED 2026-09-30 by owner decision, with an accepted limitation.**
> - **Evidence:** the live export (`h4-live-export.ts`, after fixing a wrong calendar column in its query) and `compare-live.py` against Zendesk, on the host's one non-fixture organization (the dev sandbox): 45 tickets; 33 MATCH, 7 SEMANTIC, 13 DATA, 18 initially UNEXPLAINED. **All 18 were then explained; none is an unexplained engine defect:**
>   - 12 Resolution elapsed differences: **H-12 / D30**. Finished commitments still carry the old Pending pause; each shortfall equals the time in `pending_customer` to the second (16, 44, 8, 8, 216, 123, 72, 824, 5, 50, 3184, 45 s), confirmed by query.
>   - 4 First Response target rows (tickets 21, 46, 47, 48): **D5b**, agent-submitted tickets (Zendesk: Next Reply 40 min; Elapsed: First Response 30 min).
>   - Ticket 27: the documented **reverse Next Reply case** (F4 in `h4-sla-spot-check.md`).
>   - Ticket 1: the **H-11** shape, repaired in production. Ticket 45 and the DATA rows: the since-deleted sandbox policy "Phase 4 Native Test" (F3), data not engine. The First Response rows for tickets 54 to 60 were pre-repair state and are gone after the H-11 repair.
> - **Doubled reply obligation (tickets 21, 27, 48):** an agent reply before the customer's first message on an agent-submitted ticket makes that message open both a First Response (30 min) and a Next Reply (40 min); Zendesk opens one. Deliberate in the code (`findFirstResponseEvent` is called without the D5b start bound for cycle derivation). **Owner decision 2026-09-30: a documented product semantic (D5b × Next Reply gating), not an engine defect.** Revisit if customers report duplicate reply alerts.
> - **Limitation, accepted (no second tenant or export required):** the acceptance below asks for two live tenants, one on business hours, open commitments included. This run covers **one** tenant (the dev sandbox), 0 open commitments, 24/7 calendar. Not covered: business hours, holidays, DST, open commitments and at-risk state, legs, any live customer tenant. Risk accepted: a difference specific to those areas would first show in N1's replay/diff gate or in production.
>
> The procedure and the caveat below are historical: the export has since been run against Zendesk (with the calendar-column fix).

**Acceptance (roadmap):** engine numbers spot-checked against Zendesk's own SLA view on real tickets for **at least two live tenants**; any unexplained disagreement opens a correctness task **before** N1 starts. **Proposed closing evidence** (mine, to cover what the dev-sandbox run could not): at least two live tenants; at least one on a business-hours calendar; open commitments included; every row classified; **UNEXPLAINED = 0, or each one a filed task**. The 45-ticket dev run alone does not close H-4.

1. Pick tenants (host only; this prints ids, keep them off the repo):

```bash
docker compose -f docker-compose.yml --env-file .env.prod exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' < scripts/prod/h4-pick-tenants.sql
```

2. For each of two organizations (prefer `uses_business_hours = t` and `open_commitments > 0`). This reads Zendesk with **the tenant's stored OAuth token, GET only**. That is the customer's data on their Zendesk: **confirm you are content to read it before running**.

```bash
mkdir -p h4-out
docker compose -f docker-compose.yml --env-file .env.prod run --rm --user root \
  -v "$PWD/h4-out:/out" worker \
  pnpm --filter @sla/db exec tsx src/scripts/h4-live-export.ts <ORGANIZATION_ID> /out/tenant-A.json --limit=150 --open-limit=60
python3 scripts/h4-compare/compare-live.py h4-out/tenant-A.json --label tenant-A --out h4-out/tenant-A.md
```

3. Send me `tenant-A.md` and `tenant-B.md` (they contain ticket ids and timestamps, no ticket text; strip the ticket column if you prefer, I only need the class counts and the notes). Keep the JSON on the host.

**Caveat, stated plainly:** `h4-live-export.ts` type-checks clean under `tsc` but was **not run against a Zendesk account**: my attempt to run it against the dev sandbox was blocked by the permission classifier (it would have decrypted the dev organization's stored Zendesk credentials), and I did not work around it. The Elapsed-side SQL was validated with `psql` on the dev database, and the comparer against a synthetic fixture, but the Zendesk response shapes (`metric_events`, `slas.policy_metrics`) are parsed tolerantly from the shapes the earlier dev run used. If you want it proven before it touches a live tenant, run step 2 once against the dev sandbox yourself (`<ORGANIZATION_ID>` = `cmul45pok0000nlrybb0hfrt3`) and I will check the output. The dev result should reproduce the known picture (32/32 Resolution on the current policy).

## H-6 — Sentry source maps

**Acceptance:** maps appear in the Sentry project and a test error shows a readable stack. Code side is done. Needs from you: a Sentry auth token (scopes `project:releases`, `org:read`), org slug and project slug. On the host: set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (and `SENTRY_URL` if self-hosted) in `.env.prod`, rebuild `web` (`docker compose -f docker-compose.yml --env-file .env.prod build web && … up -d web`), then trigger a deliberate error and check the stack in Sentry. Do this **after** you replace the leaked `SENTRY_DSN` (finding 1).

## H-8 — lint step

`typescript-eslint` 8.71.0 (latest) declares `typescript >=4.8.4 <6.1.0`; the repo is on 7.0.2. Still blocked upstream. The roadmap's stated alternative is to pin TypeScript 6.x for lint tooling only. That means two TypeScript versions in the workspace, which I did not do without your say-so. **Decision for you:** wait for upstream, or accept a lint-only TS 6 pin.

## H-9 — live onboarding walkthrough

**Acceptance (roadmap 6.8):** walk through onboarding with a **fresh organization** against a **real Zendesk sandbox** and record the result. It can run entirely on your machine (no production).

What only you can do: the Zendesk sandbox admin login and the OAuth client. Prepare once:
- In the Zendesk sandbox (Admin Center → Apps and integrations → APIs → OAuth clients) create a client whose redirect URI is the one the local stack shows in **Settings → Integrations → Configure**.
- Start the stack: `docker compose --env-file .env.docker up -d` (never plain `up`; see the local-stack note).

Then, with a timer, as a first-time user and without help: sign up with a **new email** and verify it → onboarding → enter the OAuth client id/secret → connect Zendesk (sandbox login) → import runs → policies reviewed → first case visible → Slack/email step skipped or done. Record: wall-clock minutes from sign-up to first monitored case, every step where you hesitated or needed this document, any error, the count of tickets/policies imported. Send me those notes; I will write them up under 6.8/H-9 and tick it only if the flow completed unaided. I can also do the sign-up and timing on localhost with a test account if you would rather only handle the Zendesk step.

## H-10 — production security verification

**Acceptance (roadmap):** confirm and record: leaked secrets rotated; no development services in production; authorization audit current; tenant isolation covers every model.

Run on the host, from a full clone (needs git history):

```bash
scripts/prod/h10-verify.sh .env.prod
```

It prints PASS/FAIL/MANUAL and never a value. Your part beyond the script: (1) replace `OPS_ALERT_SMTP_PASSWORD` (and decide about the ops SMTP account) and `SENTRY_DSN` at their providers and add a row to the rotation log in `docs/deployment.md`; (2) answer the MANUAL lines. The code side (authorization re-audit and behavioural tenant tests) is done: see the next section.

## H-10 code audit: mutation routes and tenant isolation

**Done 2026-09-29, no production access used.** Scope: every file under `apps/web/src/app/api` (71 `route.ts`), server actions (none exist: no `"use server"` anywhere), and mutations outside the API layer (none: no `prisma.*.update/delete/create` outside `app/api` in `apps/web/src`; writes go through `@sla/db` / `@sla/commitments` helpers, which I read for the settings paths).

**How each route family gets its organization and authorizes:**

| Family | Authentication | Organization comes from | Ids from the request |
| --- | --- | --- | --- |
| `settings/*` mutations, `integrations/*` connect/callback/disconnect/backfill/config POST | session + `requireOwner` | the session, never the body | policy, calendar, customer, invitation, member ids are re-checked with an org-scoped `findFirst` (or an `updateMany`/`deleteMany` with `organizationId` in the `where`) before any write |
| `settings/*` and other GETs | session (any member) | the session | — |
| `me/*` | session + current-password re-entry, throttled | the session's own user id | — |
| `concierge/*` | session | session, then `authorizeSourceExport` re-checks the organization and that the integration belongs to it (cross-org gets 404) | body ids only say "which of my rows" |
| OAuth callbacks | session + owner + HMAC-signed state bound to org, user and a cookie | signed state | — |
| `settings/worker` | session + platform operator (`PLATFORM_ADMIN_EMAILS`) | global settings by design | — |
| Webhooks (Zendesk, Jira) | shared secret, timestamp freshness | the integration row | integration id from the URL, secret verified before any work |
| `password-reset`, `email-verification`, `invitations/accept`, `sign-up` | public; single-use hashed tokens, claimed atomically | the token's own row | — |

`requireOwner` and revocation: `getServerSession` runs the `jwt` callback, which re-checks the user row and `sessionVersion` on every request, so member removal and password changes take effect immediately (5.7 works as documented).

**Tests added** (`apps/web/test/tenant-isolation.test.ts`, real Postgres, 12 new cases, 25 total, all pass; each write case has an own-org control where it matters):
reads (members, pending invitations, import review, integrations with Slack and OAuth config, case detail with events, links, notifications, policy changes, dashboard failed alerts); revoking another org's invitation; changing or removing another org's member; Slack channel and disconnect; saving an OAuth client config; a policy override creating nothing for another org; consuming reset and verification tokens touching only their own user, and single-use replay (410); demotion and removal invalidating sessions; a plain member denied every owner route. `tenant-scope-classification.test.ts` now also fails if any tenant-scoped model is not seeded by the isolation suite (29 tests). The former list of 13 unnamed models is now all covered, with one exception noted in F-E.

**F-D / F-G follow-up tests:** `packages/email/test/destination.test.ts` (address classification for 40+ IPv4/IPv6 forms, resolution rules, connect-to-resolved-address, operator path untouched, env override); 11 route-level cases in `tenant-isolation.test.ts` (changed host or username refused on save and on both test routes, allowed with the password or for port-only changes, six internal destinations refused on all three routes, plain member denied); `packages/db/test/email-settings.test.ts` (the old "keeps the old password on a new host" test encoded the bug and was replaced); `apps/web/test/csv-formula-injection.test.ts` (20 cases: every trigger character, look-alike exemptions, and the compliance-report and Zendesk exports); `packages/notifications/test/dispatch.test.ts` updated for the new send option.

**Files changed for F-D / F-G:** `packages/email/src/destination.ts` (new), `packages/email/src/client.ts`, `packages/email/src/index.ts`, `packages/db/src/email-settings.ts`, `packages/db/src/index.ts`, `packages/notifications/src/dispatch.ts`, `apps/web/src/lib/email-settings.ts`, `apps/web/src/app/api/settings/email/route.ts`, `.../email/test-connection/route.ts`, `.../email/test-send/route.ts`, `packages/core/src/csv.ts`, `docs/deployment.md` (new env var).

**Findings**

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-A | **High (privilege)** | The role is baked into the JWT at sign-in and never re-read; `updateMemberRole` did not bump `sessionVersion`. An owner demoted to member kept every owner-only power (remove members, disconnect integrations, change SMTP, policies) for up to 30 days. | **Fixed** in `packages/db/src/members.ts` (bumps `sessionVersion`; the member is signed out and back in with the new role). Test fails without the fix (verified). |
| F-D | Medium | The email test and send routes connected to an owner-supplied host and port with no destination check, and a blank password fell back to the organization's **saved** password whatever host was typed. | **Fixed 2026-09-29.** (1) A blank password now applies only while host and username equal the saved ones (`savedPasswordApplies`, `SmtpPasswordRequiredError` in `packages/db/src/email-settings.ts`); enforced in `saveEmailSettings` and in `resolveTestPassword` for both test routes. (2) `@sla/email` refuses non-public destinations (`destination.ts`): resolves the host, refuses when ANY address is loopback, private, link-local, CGNAT, multicast, reserved or documentation space (IPv4, IPv6, v4-mapped, NAT64, 6to4, Teredo), and connects to the resolved address with the typed name as TLS servername, so DNS can't change between check and connect. Applied to Test Connection, Send Test Email and every alert send (`publicDestinationOnly`), and at save (private only; an unresolvable name may still be saved). `SMTP_ALLOW_PRIVATE_HOSTS=1` is the documented local/intranet escape hatch. Operator-configured SMTP is untouched. |
| F-G | Low–medium | the CSV writer (now `packages/core/src/csv.ts`, formerly cited here as `lib/csv.ts`) did not neutralize text cells starting with `=`, `+`, `-`, `@` (or tab/CR); case subjects, customer names and tags come from customers' end users. | **Fixed 2026-09-29** at the single choke point every export uses (compliance report CSV and stream, cases export, Zendesk and Jira concierge ZIPs): string cells get a leading `'`. Number cells, plain signed numbers and the app's own overdue durations (`-1h 5m`, shown in the cases export's Remaining/Elapsed column) are exempt, because the rule would otherwise corrupt them. Effect on the concierge analyzer: only formula-leading text (for example a subject starting `-`) gains a `'`. |
| F-E | Info | `LegSpan` is never read or written by any code (legs are derived in memory). The model is tenant-scoped through `Case` and seeded by the suite, but no code path exists to test. | Noted; candidate for removal in N1's legs work. |
| F-H | Info | `operator-monitoring-data` reads `NotificationFailure` across all organizations by design (platform-operator only). | Intended; left as is. |
| F-I | Info | The webhook returns 404 for an unknown integration id and 401 for a wrong secret, so a valid integration id can be distinguished. Ids are unguessable cuids. | Accepted. |

**Not audited:** business logic of the pipelines (not request-driven), the marketing pages, `apps/concierge`, and rate limiting (in-memory, per instance, N8-S5).

**H-10 is still not tickable, and only the production half remains**: the production half (secret rotation of the ops SMTP password and Sentry DSN, dev services, plaintext tokens) needs `h10-verify.sh` on the host. The two code-side items in the roadmap wording, "authorization audit current" and "tenant isolation covers every model", are satisfied by this section and the tests, F-D and F-G are fixed. Remaining code-side findings are informational only (F-E, F-H, F-I). Not addressed, on purpose: SMTP port allow-listing (a public host on an odd port is not an internal-network risk) and a certificate pin for organization SMTP.

## H-2 — D14 (closed)

**Closed 2026-10-05.** The question was: which pricing model is current, and which do the 10 customers pay on? The owner decided D14: the **live model** is current. It is Starter **$49**, Team **$149**, Enterprise Custom, seat-based and flat monthly in USD, implemented once as `PLANS` in `packages/db/src/plans.ts` and rendered by the pricing page (roadmap N6.1). The `plans/03` Phase 18 model (Starter $79, Growth $149, Scale $249, by monthly escalations) is **not adopted**, and the obsolete `$299/$699` pilot pricing in `plans/05` must not be reintroduced.

What is still open is data, not a decision: which plan each of the 10 customers actually pays or was quoted. That is roadmap N4.7 (enter it in the admin tenant page); a count per plan is enough, no names.

## Deploy-time steps from H-11 and H-12

Not H items, but they are owed when these changes reach production and were flagged in the roadmap:
- **H-11: DONE 2026-09-29.** The repair (`repair:first-response-start`: dry run, review, `--apply`, worker cycle) was run on the host database for its one non-fixture organization. Recorded result:
  - Dry run: 7 of 16 first-response commitments disagreed with the D5b rule (tickets 54 to 60, all `breached`, expected start none).
  - Backup before the delete: `backups/sla-20260929T213644Z.dump` (3.4 MB). Note for next time: `backup.sh` defaults to `ENV_FILE=.env.prod` and the container's `$POSTGRES_DB`; on this host the app database is `elapsed_db` and the env file is `.env`, so it was run as `ENV_FILE=.env DB_NAME=elapsed_db ./scripts/backup.sh`.
  - Notifications on those 7 commitments before the delete: **0** (no false-breach alert had been sent).
  - `--apply` deleted exactly those 7. After the worker cycle: ticket 1's First Response commitment recreated; tickets 54 to 60 still have none (owner's verification).
  - Method, for reference (unchanged): deleting a commitment cascades its evaluations and notifications, so review the dry-run list and check notifications first.
- **H-12:** migration `20260929120000` changes elapsed time for open Resolution commitments on imported policies with Pending time; some may breach sooner and a breach is final (D2). **Tell customers before deploying.**

## N1 readiness

**Update 2026-09-30: H-1 and H-4 are closed (each with the accepted limitation recorded above), so N1's entry gate is met and N1 is unblocked.** N1's declared entry gate was **H-1 and H-4** (roadmap phase table and the Production Hygiene preamble). With both closed, N1 needs no further roadmap audit: N1.0 ("H-1 recorded, backup restored into the scratch DB") is then satisfied except the backup restore, which is N1's own first task (`scripts/restore-drill.sh` exists). H-2 (since closed), H-6, H-8, H-9 and H-10 do not gate any N-phase (H-5 gates N5.4 and N8-S6 and is done). What could still surprise N1: an UNEXPLAINED row from H-4 becoming a correctness task, which is what H-4 exists to surface.
