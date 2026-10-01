# D29 — Zoho Desk due diligence (decision record)

> **Status:** investigation complete, **no code written**. Prepared 2026-10-01 for roadmap decision **D29** (third ticket source) and plan [`07-third-ticket-source.md`](07-third-ticket-source.md).
> **Decision: CONDITIONAL GO** (technically viable; two conditions must be met before D29 can close as Zoho Desk — see §13).
> **Method:** read the N2 contract and the Zendesk/Intercom adapters in this repo, then read Zoho's official docs (the full Desk API reference, the Desk webhook reference, the Zoho OAuth protocol pages and the Desk help-center articles). **No live Zoho calls were made** (no sandbox account or credentials). Every claim is tagged:
>
> - **[V]** stated in official Zoho documentation (source given)
> - **[U]** not stated or contradictory in the docs; **must be confirmed in the N7.1 spike** against a real sandbox
> - **[D]** derived by me from [V] facts plus the Elapsed code

---

## 0. Two findings that come before the technical verdict

1. **Zoho Desk is not a D29 candidate and does not meet the D29 evidence bar.** The roadmap lists the candidates as Freshdesk, Pylon and HubSpot (`ROADMAP_Product.md` D29, N7 trigger) and requires **at least two customers or qualified prospects on the same helpdesk, recorded**. The only Zoho signal in the repo is **one** prospect, Crexendo (`plans/target-list.csv`: "JD names Zendesk and Zoho as support tooling", status `needs_qualification`). That company also lists Zendesk, so it is not even clearly a Zoho-only tenant. Technical viability does not satisfy the plan's own rule ("No theory-only choice… If no provider meets the evidence bar, N7 does not start").
2. **One premise in the task could not be confirmed.** The brief mentions a "documented restriction that Zoho webhooks require a publicly accessible callback URL and may not support authenticated webhook URLs directly". I found **no such statement** in the official Desk webhook reference. What *is* documented is in §4. The practical conclusion (JWT is the only auth mechanism, and no intermediary is needed) is the same either way.

---

## 1. The contract Zoho must satisfy (read from the code)

| Area | What the code requires | Where |
|---|---|---|
| Adapter record | `provider`, `role: "ticket_source"`, honest `capabilities`, `ingest()`, `normalize()` → `CanonicalBatch`, optional `recognizeCaseUrl()`; web-side `externalUrl()`, `renderConversation()`, optional `verifyWebhook()` | `packages/ingestion/src/contract.ts` |
| Projector | Only the projector writes `Case`, `Customer`/`CustomerIdentity`, `NormalizedEvent`. Adapters never write them. Events are diff-reconciled per case by `ownRawEventIds` | `packages/ingestion/src/projector.ts` |
| Case facts | `externalId, subject, assigneeName, priority, channel, openedAt, closedAt, customer(ref), requesterName?, tier?, tags?, attributes?`. Optional fields **omitted = leave stored value** | `CaseFacts` |
| Events | `case_created, state_changed, case_closed, agent_replied, customer_replied, priority_changed` with `actor`, `sourceRole`, `fromState/toState`, `sourceRawEventId`, **`sourceSequence`** (provider's own order, used as a tie-break) | `NormalizedEventFact`, `core/src/ordering.ts` |
| States | `new, open, pending_customer, pending_internal, in_progress, escalated, resolved, closed`. A new semantic state is a **domain change**, not an adapter change (N7.1) | `core/src/types.ts`, plan §N7.1 |
| Raw storage | `RawEvent` is immutable, insert-only, deduped by `(integrationId, providerEventId)`; normalizers read RawEvents only | schema, `zendesk/backfill.ts` |
| Ingest | `ingest()` fetches into `RawEvent` and keeps a resumable cursor on `Integration.cursor`; default window 90 days | `zendesk/backfill.ts`, `intercom/backfill.ts` |
| Freshness | Worker runs a 5-minute active-set poll and an hourly reconciliation sweep, both calling the same `ingest`. Webhooks are an *optional accelerator*: the Zendesk receiver treats the payload only as a **ticket-id hint** and refetches that ticket from the API | `apps/worker/src/cycle.ts`, `app/api/webhooks/zendesk/.../route.ts` |
| Auth lifecycle | OAuth code flow; per-organization OAuth client config; refresh single-flight with DB compare-and-swap; `ReauthRequiredError` / `PermissionDeniedError` / `ProviderUnavailableError` | `zendesk/tokenLifecycle.ts`, `ingestion/errors.ts` |
| Retry | `fetchWithRetry`: 5xx and opt-in 429, `Retry-After` honoured, exponential backoff otherwise, ≤5 attempts and ≤60 s total wait | `http-retry/src/retry.ts` |
| Links | Trackers link *to* tickets by URL; `recognizeCaseUrl(url, credentials)` must accept only the org's own tenant | `zendesk/ticket-url.ts`, `intercom/ticket-url.ts`, `jira/correlate.ts` (reads Jira **remote links**) |
| Registration points allowed for N7 | enum + migration, two registries, `app/api/integrations/<p>/*`, settings card, `lib/<p>-env.ts` | plan §N7.4 |

**Design fact that matters most:** because the webhook is only a hint and polling is the safety net, Zoho's weaker webhook guarantees (§4) are **not** a correctness risk. They affect freshness only.

---

## 2. Authentication and connection model

| Question | Finding | Tag / source |
|---|---|---|
| OAuth 2.0 | Yes. Authorization-code flow for server apps; Desk APIs use OAuth 2.0 only | [V] [Desk API doc → "API Authentication"](https://desk.zoho.com/DeskAPIDocument) |
| Authorize / token endpoints | `GET {accounts-server}/oauth/v2/auth`, `POST {accounts-server}/oauth/v2/token`; `access_type=offline` (+ optionally `prompt=consent`) is required to get a refresh token, returned only on the first exchange | [V] [OAuth: authorization](https://www.zoho.com/accounts/protocol/oauth/web-apps/authorization.html), [access token](https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token.html) |
| Access token life | 3600 s | [V] same |
| Refresh | `grant_type=refresh_token` returns a new access token, **no new refresh token** (keep the old one). Elapsed's `toCredentials` already keeps the previous refresh token | [V] [refresh](https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token-expiry.html); [D] fits `zendesk/oauth.ts` |
| Refresh-token expiry | The pages I read are **silent** on expiry. Handle `invalid_grant`/`invalid_code` as `ReauthRequiredError`, exactly as Zendesk does | [U] |
| Token limits | ≤10 active access tokens per refresh token; ≤10 access-token requests per 10 min; ≤20 refresh tokens per user per client; auth codes valid 2 min, ≤10 per 10 min per user | [V] [token limits](https://www.zoho.com/accounts/protocol/oauth/token-limits.html). Single-flight refresh keeps Elapsed far below this |
| Org binding | A token is bound to **one** Desk organization (portal) at consent; with several orgs the user picks one. `orgId` header is optional, but if sent it must match or the call fails with `OAUTH_ORG_MISMATCH` | [V] Desk API doc → "Organization Binding" |
| Multi-organization | One Elapsed org ↔ one Zoho org matches `Integration @@unique([organizationId, provider])`. Same limitation as Zendesk | [D] |
| Data centers | 10 Desk DCs: US `desk.zoho.com`, IN `.in`, AU `.com.au`, CA `desk.zohocloud.ca`, SA `.sa`, JP `.jp`, CN `.com.cn`, EU `.eu`, SG `.sg`, AE `.ae`. Accounts server is per DC; the callback carries `location` and `accounts-server`; the token request must go to the user's DC | [V] Desk API doc → "API Endpoints by Data Center"; [multi-DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html) |
| **Which base URL to call** | **Contradiction.** The Desk doc says "always use the `api_domain` from the access token response", but Zoho's generic OAuth pages show `api_domain` as `https://www.zohoapis.in` / `https://api.zoho.eu`, not `desk.zoho.*`. Do not trust `api_domain` for Desk. Derive the Desk host from the DC (`location` / `accounts-server`) with a static table, and confirm in the spike | [U] |
| Whose OAuth client | Elapsed already resolves an OAuth client **per organization** (`getIntegrationConfig`, `zendesk-env.ts`). The customer registers a server-based client in the API Console **of their own DC**, so the DC is effectively fixed by where they register. No Elapsed-wide multi-DC setup is needed | [D] |
| Who can grant | Calls run as the authorizing agent, and ticket/contact fields are filtered by that agent's **profile**; search without `departmentId` covers only "permitted departments". The connector must be an admin-type profile with all departments and all fields, or data silently goes missing | [V] Desk API doc → "Conventions", Search Tickets; [D] consequence |
| Provider-specific architectural exception? | None. Connect route takes a DC choice instead of Zendesk's `subdomain`, and the credentials JSON holds `{orgId, dc, accountsServer, deskBaseUrl, portalName, …}`. Both are provider-owned code in the N7.4 allow-list | [D] |

### Scopes (all read-only for the polling baseline)

| Need | Scope | Source |
|---|---|---|
| Tickets, threads, comments, history | `Desk.tickets.READ` | [V] Get Tickets / threads / comments / History |
| **Incremental query** (`modifiedTimeRange`) | `Desk.search.READ` (+ `Desk.tickets.READ`) | [V] Search Tickets |
| Contacts (and their account) | `Desk.contacts.READ` ("contacts, accounts and related data") | [V] scope table |
| Accounts (direct fetch) | `Desk.accounts.READ` appears on `GET /accounts/{id}` but **not** in the overview scope table | [U] inconsistent |
| Org info, agents, departments, **ticket field metadata (status → statusType)** | `Desk.basic.READ` | [V] `GET /organizations`, `/agents`, `/departments`, `/fields` |
| Webhook subscription management (optional, phase 2) | `Desk.webhooks.CREATE/READ/UPDATE/DELETE` in the webhook doc, but `Desk.events.*` in the overview scope table | [U] inconsistent. Requesting a non-existent scope fails the authorize step, so test in the spike |

Scopes are comma-separated: `scope=Desk.tickets.READ,Desk.search.READ,Desk.contacts.READ,Desk.basic.READ`. Webhook management needs **write** scopes on the events subscription (not on tickets). That conflicts with the plan's "read-only OAuth" preference only if Elapsed creates webhooks itself. Polling-only stays read-only.

---

## 3. Ticket API → canonical field map

Base: `GET /api/v1/tickets` (list, 100/page), `GET /api/v1/tickets/search` (100/page), `GET /api/v1/tickets/{id}`, `/threads`, `/comments`, `/History`. Source: [Desk API doc → Tickets](https://desk.zoho.com/DeskAPIDocument) unless noted.

| Elapsed canonical field | Zoho source | Available? | Nullable? | Stable? | Extra call? | Notes |
|---|---|---|---|---|---|---|
| `Case.externalId` | `id` (string, ~17 digits) | Yes | No | Yes | No | **Keep as string**; 17-digit ids exceed JS safe-integer range. The samples return them quoted |
| ticket number (display) | `ticketNumber` | Yes | No | Yes | No | Not the key |
| external URL | `webUrl` = `https://desk.zoho.com/support/{portal}/ShowHomePage.do#Cases/dv/{id}` | Yes | No | Mostly | No | The id is in the **URL fragment**; portals may use a custom domain (`includeCustomDomain` on organizations). Plan `recognizeCaseUrl` accordingly |
| `subject` | `subject` | Yes | Possible | Mutable | No | Display only |
| description | `description` (HTML) | Yes | Yes | Mutable | No | Not a canonical Case field; Conversation reads threads |
| state | `status` (display name, can be custom) and **`statusType` ∈ OPEN / ON HOLD / CLOSED** | Yes | No | Yes | Field-metadata call to learn custom-status→type | See §7 |
| `priority` | `priority` (free string; system values Low/Medium/High, custom allowed) | Yes | Yes | Mutable | No | **No "urgent"** in the system set. Map Low→low, Medium→normal, High→high; custom values pass through unmapped (the contract allows it) |
| `openedAt` | `createdTime` (ISO, UTC, ms) | Yes | No | Yes | No | |
| updated-at (reconciliation) | `modifiedTime` | Yes | No | Mutable | No | Bump-on-reply is **[U]** (§6) |
| `closedAt` | `closedTime`; or derived from history | Yes | Yes | Mutable | No | Better fallback than Zendesk's `updated_at` |
| due date | `dueDate`, `responseDueDate`, `isOverDue`, `isResponseOverdue` | Yes | Yes | n/a | No | **Deliberately not imported** (§8) |
| requester | `contactId`, `contact{firstName,lastName,email,phone,account}` | Yes | Contact is mandatory on create | Stable id | No | → `requesterName`. See §9 |
| assignee | `assigneeId`; name needs `include=assignee` (get/list) or an agents lookup | Yes | Yes | Mutable | Small cached `GET /agents` (Intercom admin-list pattern) | → `assigneeName` |
| department | `departmentId` / `department{id,name}` | Yes | No | Mutable (transfers) | No | Could go to `attributes` |
| account / organization | `accountId`; `contact.account{accountName,id}` | Yes | **Yes** | Stable id | No | → `CustomerIdentity(kind:"account")` |
| tags | **only `tagCount`** on the ticket | **No** (inline) | n/a | n/a | `GET /tickets/{id}/tags` per ticket | **Omit** (`tags` optional, same as Intercom). Tag-based policy conditions unsupported for Zoho |
| custom fields | `cf{cf_<apiName>}` / `customFields` | Yes | Yes | Per org | Fields API for names | Optional → `attributes` |
| channel | `channel` (EMAIL, TWITTER, FORUMS…), `source{type,permalink,…}` | Yes | Possible | Yes | No | → `channel` |
| deleted / trashed | `isDeleted`, `isTrashed`, `isArchived` flags; webhook `Ticket_Delete` | Partial | | | No documented *list-trashed* endpoint | See §9/§11 |
| attachments | `attachmentCount`, `descAttachments`, per-thread `attachments` | Yes | | | No | Not needed |
| threads | `GET /tickets/{id}/threads` (limit ≤200): `direction in/out`, `author.type AGENT/END_USER`, `visibility public/private`, `status SUCCESS/PENDING/FAILED/DRAFT`, `isDescriptionThread`, `createdTime`, `channel` | Yes | | | 1+ call/ticket | The reply source and the Conversation content |
| comments | `GET /tickets/{id}/comments` (`isPublic`, `commentedTime`) | Yes | | | 1+ call/ticket | Zoho "comments" are internal notes; **never a reply** |
| history | `GET /tickets/{id}/History` (limit ≤50): `eventName`, `eventTime` (ISO, second precision), `actor{type,id,name}`, `eventInfo[]` with `propertyValue{previousValue,updatedValue}` for Status and Priority | Yes | | | 1–3 calls/ticket | The transition source (§7). Supports `fieldName=status` and `eventFilter` |

**Canonical fields Zoho cannot provide:** `tags` (without N+1), a `resolved`-vs-`closed` distinction, a `pending_customer`-vs-`pending_internal` distinction (except via customer-defined custom status names), an "urgent" priority. None is required by `CaseFacts`, and none needs a new domain state (§7).

---

## 4. Event model / webhooks

Source for everything in this section: [Zoho Desk Webhook Documentation](https://desk.zoho.com/support/WebhookDocument.do) [V] unless marked.

| Question | Finding |
|---|---|
| Events | 47+. Relevant: `Ticket_Add`, `Ticket_Update`, `Ticket_Delete`, `Ticket_Thread_Add`, `Ticket_Comment_Add/Update`, `Ticket_Attachment_*`, `Contact_Add/Update/Delete`, `Account_Add/Update/Delete` |
| Full current state? | Yes. `payload` = "current state of the resource". Ticket events carry the whole ticket (status, statusType, priority, contact, accountId, closedTime, onholdTime, isTrashed, `webUrl`, `cf`…) |
| Previous state? | Optional: `prevState` on **update** events only, **only if `includePrevState` was set when subscribing** |
| Event timestamp? | `eventTime` (epoch ms, as a string) |
| Delivery shape | A JSON **array** of events (batching possible) |
| Ordering | "Order of events within each module is preserved if there are no failed events, whereas order of events across modules is not preserved." So a `Ticket_Update` and a `Ticket_Thread_Add` can arrive out of order |
| Duplicates / dedup id | **Not documented**; the payload has no delivery id. Treat as at-least-once |
| Retries | **Not documented** (no count or backoff). Only: failure = non-200 or **no response within 5 seconds**; a `410 Gone` **auto-removes** the subscription |
| Validation on create/update | Zoho first sends a **GET** to the URL (expects 200), then a **POST** if that fails. The endpoint must answer both, or webhook creation fails |
| Auth / signature | **JWT only.** Header `X-ZDesk-JWT`, RS256; claims `iss="orgId:<id>"`, `aud="webhookId:<id>"`, `iat`, `exp`; header carries `kid`; public keys at `https://desk.zoho.com/.well-known/jwks.json`. I confirmed every DC host serves `/.well-known/jwks.json` with HTTP 200. Docs say `exp`/`iat` are milliseconds but the example is in seconds: handle both [U] |
| Custom headers / shared secret / basic auth | **Not documented** for event subscriptions. A shared-secret model like Zendesk's Bearer token is not available |
| Callback URL | HTTP or HTTPS (HTTPS "strongly recommended"). The docs contain **no** "must be publicly accessible" or "authenticated URLs unsupported" statement; any receiver has to be internet-reachable regardless |
| Manage via API | Yes: `GET/POST /api/v1/webhooks`, `GET/PATCH/DELETE /api/v1/webhooks/{id}` |
| Limits | **Edition-gated:** Free 0, Standard 0, Professional 5, Enterprise 10, Ultimate 20 enabled (max 20 configurable). Express is **absent** from the table [U]. Downgrade keeps the oldest N. Creating webhooks also needs a profile with the Webhook permission |
| Filters | `departmentIds`; per-field tracking on `Ticket_Update` (≤5 fields); thread `direction` filter; `ignoreSourceId` to suppress self-generated events |

**Does JWT validation solve authentication without an intermediary? Yes, with one caveat.**

- Elapsed's receiver is already public and unauthenticated by session. It can verify RS256 against the DC's JWKS (cache by `kid`) and check `iss`/`aud`/`exp`. That needs no proxy.
- The JWT signs **header and claims, not the body** (the doc says the signature "ensures that both the header and the claims are not altered"). A captured token could be replayed within its short lifetime with a different body. Elapsed's existing pattern neutralises this: use the payload **only as a ticket-id hint and refetch from the API** (what the Zendesk route does). Worst case is a harmless re-read.
- `ProviderWebAdapter.verifyWebhook(req, secret)` can carry `"orgId:…|webhookId:…"` as its opaque `secret`, so the contract does not change.
- Two non-trivial obligations if webhooks are ever built: (a) the route must also answer **GET** for validation, and (b) it must **acknowledge in under 5 s**. The Zendesk route runs ingest, normalize and the commitment pipeline synchronously (`maxDuration = 60`), which would time out; Zoho would need ack-then-process.

**Consequence:** for N7 set `capabilities.webhooks = false`. This matches plan §9 ("Webhooks for the new provider (unless trivially available and verified live)"). Freshness comes from the 5-minute poll, as Intercom does today. Webhooks become a later accelerator for Professional+ tenants.

---

## 5. Backfill / historical synchronization

| Question | Finding | Source |
|---|---|---|
| List endpoint | `GET /tickets`: `from` (offset), `limit` 1–100, `sortBy` ∈ {`responseDueDate`, `customerResponseTime`, `createdTime`}, `receivedInDays` ∈ {15,30,90}. **No modified-since or created-range filter, and no `modifiedTime` sort** | [V] Get Tickets |
| Search endpoint | `GET /tickets/search`: `modifiedTimeRange`, `createdTimeRange`, `customerResponseTimeRange`, `dueDateRange` (ISO `from,to`), `sortBy` ∈ {relevance, `modifiedTime`, `createdTime`, `customerResponseTime`}, `limit` 1–100, **`from` only 0–4999** | [V] Search Tickets |
| Pagination | Offset (`from`/`limit`), not cursor. General cap is 50/request unless an API says otherwise (tickets 100, threads 200, comments 100, history 50) | [V] "Pagination" |
| Historical depth | No stated retention limit. Archived tickets are a separate listing (`/tickets/archivedTickets`, `departmentId` required, `from` 0–4999) | [V]; effect on history of archived tickets [U] |
| Deleted/trashed | No documented "list trashed tickets" endpoint. Signals are `Ticket_Delete` (webhook) and per-id `isTrashed`/404 | [V] absence; behaviour [U] |
| Rate limits | **Daily credits** per portal: Free/Trial 5,000; Express 25,000 + 100/user; Standard 50,000 + 250/user; Professional 75,000 + 500/user; Enterprise/Zoho One/CRM Plus 100,000 + 1,000/user (light agents excluded). Reset every 24 h in the DC's timezone. Extra credits purchasable by emailing Zoho | [V] "API Credits" |
| **Concurrency** | Free/Trial 5, Express 10, Standard 10, Professional 15, Enterprise 25 simultaneous calls. Excess → `429 TOO_MANY_REQUESTS` | [V] "Concurrency Limits" |
| Credit cost | Get by id: 1. Search with unique id: 1. Fetching a record range: **3 credits for offsets 0–2,000; 5 for 2,001–10,000; 10 for 10,001–50,000; 50 for 50,001–100,000; 100 above 100,001**, per call. Threads/comments/history/search/list are all "3 credits/call (depends on range)" | [V] "Credit Consumption Model" |
| Headers / 429 | `X-Rate-Limit-Request-Weight-v3` (cost of this call), `X-Rate-Limit-Remaining-v3` (credits left today). `Retry-After` is documented as appearing **only when the daily credit limit is hit**; concurrency 429s carry no `Retry-After`. Error codes `TOO_MANY_REQUESTS` and `THRESHOLD_EXCEEDED` | [V] "Ratelimit Response Headers", error codes |
| N+1 | Contacts and account names are embedded in the ticket (`contact.account`). Assignee names need one cached agents list. **Threads and history are per-ticket N+1**, as Zendesk audits and Intercom parts already are. Tags would be a third N+1 (omitted) | [V]/[D] |
| Quota is shared | Credits and concurrency are **per portal**, not per app. Elapsed competes with the customer's own automations and integrations | [V] "portal"; [D] implication |
| Not authoritative | A community post on rate limits shows older/unclear behaviour; I did not rely on it | — |

### Request pattern (design)

1. Walk `modifiedTimeRange` (or `createdTimeRange` for the first pass) in **time windows** with `sortBy=modifiedTime`, `limit=100`. If a window returns the 5,000 cap, split it. Windowing keeps every call in the cheap offset tiers (≈210 credits per 5,000 tickets, ≈0.04 credits/ticket).
2. Per ticket: `GET /threads` (1 call) and `GET /History` (1–3 calls; ≤50 events each). Write each as `RawEvent`s (ticket snapshot, threads snapshot, history pages), mirroring `zendesk/backfill.ts`.
3. Keep a small fields-metadata snapshot (status → `statusType`) and an agents snapshot as RawEvents so normalization stays replayable.

### Estimates

Assumptions (stated, not measured): typical ticket = 1 threads call + 1 history call (6 credits); heavy ticket = 1 + 3 calls (12 credits). Search cost ≈ 0.04 credits and 0.01 calls per ticket. Sequential at ~0.3 s/call. Quota budget = 50% of the daily pool, so as not to starve the customer. Daily pool examples: Standard 10 users 52.5k, Enterprise 50 users 150k.

| Tickets | HTTP calls | Credits | Wall-clock (sequential) | Days at 50% of a Standard-10 pool (26k/day) | Days at 50% of an Enterprise-50 pool (75k/day) |
|---|---|---|---|---|---|
| 10k | ≈20k | **60k–120k** | ≈1.7 h | 2.3–4.6 | 0.8–1.6 |
| 100k | ≈200k | **0.6M–1.2M** | ≈17 h | 23–46 | 8–16 |
| 1M | ≈2M | **6M–12M** | ≈7 d | 230–460 | 80–160 |

For contrast, naive offset paging of `GET /tickets` alone costs ≈460 credits at 10k, ≈29k at 100k and ≈930k at 1M, and cannot filter by modification time, so it is unusable for incrementals.

**Architectural concern, not a blocker:** a full-history import of a large Zoho portal is not viable on the customer's own quota. Elapsed does not need it. Both existing adapters default to a **90-day window** (`DEFAULT_BACKFILL_DAYS = 90`), SLA evaluation needs only active and recently closed cases, and the active set is small. The Zoho backfill must therefore be (a) windowed, (b) open-tickets-first, (c) **quota-aware**: read `X-Rate-Limit-Remaining-v3`, keep a reserve, and defer when low. Concurrency should stay at 1–2 even though the pool allows 5–25. A Free-edition portal (5,000 credits/day ≈ 800 tickets/day of import, ≈ 1/10 of a Standard pool) is only workable for very small tenants.

**Steady state** (500 tickets touched/day, ~1,000 refetches): ≈ 6k–12k credits plus ≈0.9k for 288 polls (3 credits each) ≈ 7k–13k/day, about 13–25% of a Standard-10 pool. Acceptable, but the Express/Standard floor leaves little headroom for large helpdesks. Surface the credit headers in the integration's health UI.

---

## 6. Incremental sync and reconciliation

```
poll (5 min)  ──► search modifiedTimeRange [cursor − overlap, now], sortBy=modifiedTime
              ──► per changed ticket: fetch ticket + threads + history ──► RawEvent
hourly sweep  ──► same call from the cursor + full re-derive from RawEvents (DB-only)
(optional)    ──► webhook = hint, refetch the ticket id
                         │
                RawEvent ─► normalize (CanonicalBatch) ─► projectCanonicalBatch
```

| Question | Answer |
|---|---|
| Is there a trustworthy updated-since query? | **Yes in principle:** `modifiedTimeRange` + `sortBy=modifiedTime` on search [V]. Subject to the 5,000-result window cap (split windows) |
| Is `modifiedTime` bumped by every SLA-relevant change? | **[U], the most important spike item.** The docs call it "Time when the ticket was modified" and do not say whether a **new agent thread** bumps it. `customerResponseTimeRange` is a separate search filter for customer replies, and `lastActivityTime` exists on the ticket. Spike: add an agent reply, a customer reply, an internal comment, a status change, a trash action; record which move `modifiedTime` and which appear in search |
| Fallback if replies don't bump it | Poll **the union** of `modifiedTimeRange` and `customerResponseTimeRange`, plus a bounded **by-id revalidation of open cases** (1 credit each; e.g. 500 open cases every 6 h ≈ 2k credits/day). Costly but bounded, and no contract change |
| Overlap | Reuse the Zendesk pattern: re-read a fixed overlap before the cursor (idempotent, projector writes only diffs). Offsets shift while data changes, so overlap also covers page skew |
| Missed webhooks | Not a correctness issue: the poll covers them |
| Deletions | Zendesk exports deleted tickets; **Intercom's batch always returns `deletedCaseExternalIds: []`**, so the repo already tolerates a source with no deletion signal. Zoho can do better: webhook `Ticket_Delete` when available, otherwise the by-id revalidation above (404 or `isTrashed:true` → `deletedCaseExternalIds`). Without it a deleted ticket would stay open and could raise false breach alerts |
| Search consistency | Whether search is index-lagged is **[U]**; the overlap window absorbs small lag |

---

## 7. SLA / time semantics

**Do not import Zoho's SLA.** Elapsed computes its own commitments. Zoho exposes `dueDate`, `responseDueDate`, `isOverDue`, `isResponseOverdue`, SLA/business-hours history events and a `/metrics` endpoint; none of these are used, and `calendarImport`/`policyImport` stay `false`. Elapsed's native policies and calendars apply (as for Intercom, D9). Zoho's own `On Hold` rule is documented: *"The SLA timers will freeze… no response or resolution due emails"*, and on a requester reply the ticket *"will fall back to the default status"* ([On Hold behaviour](https://help.zoho.com/portal/en/kb/desk/ticket-management/ticket-status/articles/on-hold-state-use-cases-and-behavior)). That is useful context for mapping, not an input.

### Can Elapsed's required states be distinguished and reconstructed?

| Elapsed need | Zoho signal | Verdict |
|---|---|---|
| Open | `statusType: Open` | Yes |
| Pending / On Hold | `statusType: On Hold` | **Partly.** One bucket only: Zoho does not distinguish waiting-on-customer from waiting-on-third-party except by customer-defined custom statuses (e.g. "Waiting on Customer", type `ON HOLD`) |
| Resolved vs Closed | one `statusType: Closed` | **No distinction**; Zoho allows `Closed → Open` (history example) |
| Reopened | `Closed → Open` status transition | Yes |
| Transitions with timestamps | History `TicketUpdated` with `propertyName:"Status"`, `propertyValue{previousValue, updatedValue}`, `eventTime`, `actor` | **Yes**, with explicit before/after values (like Zendesk audits, unlike Intercom which replays state). Status is a *display name*; map through the fields-metadata snapshot (`allowedValues[{value,statusType}]`, [V] `GET /fields`) |
| Replies | `ThreadAdded` history (Direction, ThreadType, SendStatus, actor) and the threads list (`direction`, `author.type`, `visibility`, `status`) | Yes. Count only `visibility=public`, `status=SUCCESS` (exclude `DRAFT`/`FAILED`; `PENDING` is **[U]**) |
| Customer vs agent | `author.type` END_USER / AGENT; history actor type Agent / Contact / System / Workflow / Blueprint … | Yes |
| Timestamp precision | History `eventTime` is **second-precision** (`…:52.000Z`), as are Zendesk and Intercom | Same-second ties rely on `sourceSequence`. History array **ordering is undocumented** [U] |
| Auto-replies | A workflow/auto-responder email is an outgoing public thread. Thread `source.type` is `"SYSTEM"` even on agent replies in the doc samples, so it cannot be used. History `actor.type` (Workflow, System…) likely can | **[U] spike item.** If automated acknowledgements cannot be told from a human first response, the First Response commitment would be wrongly satisfied. This is the one semantic risk that could flip the decision |
| Creation actor (D5b) | Description thread (`isDescriptionThread`) author type, fixed at creation | Yes |

### Proposed status mapping (for plan §6, to be confirmed in N7.1)

| Zoho (`statusType`) | `NormalizedState` | Pauses Resolution? | Notes |
|---|---|---|---|
| Open (incl. "Escalated", which is statusType Open) | `open` | No | `escalated` cannot be inferred from `statusType`; leave as `open` |
| On Hold | `pending_customer` | By policy (`pauseOnStates`) | Matches Zoho's own "pause the timers while waiting" meaning. Mapping to `pending_internal` would never pause under D7. Imperfect for "waiting on third party", an accepted limitation |
| Closed | `resolved` | Yes (unconditional, D3) | Zoho Closed is reopenable. Mapping to `closed` would let a close→reopen interval count toward Resolution, which D3 forbids |
| (new) | none | | Zoho has no "new"; do not invent one |

**No new semantic state is required**, so this is not a domain change. Per-tenant overrides keyed on custom status names are the only way to refine `pending_*` and are out of scope.

---

## 8. Customer / requester semantics

| Elapsed principle | Zoho mapping |
|---|---|
| Customer ≠ Requester | **Customer** = Zoho **Account** (`ticket.accountId`, or `contact.account`) → `CustomerIdentity{provider:"zoho_desk", kind:"account", externalId}`. **Requester** = `contact` (name/email) → `Case.requesterName` only |
| Stable ids | Account, contact, ticket ids are stable strings |
| Account name | Embedded in `contact.account.accountName` on tickets; otherwise `GET /accounts/{id}` |
| Contact → account | One `accountId` per contact in the API reference [V]. Changes to a contact's account update future tickets; handled like Zendesk org changes (the next batch re-resolves) |
| Requester changes | `contactId` can change; Elapsed stores only the display name and refreshes it on every batch |
| Deleted contacts | `Contact_Delete`, `isDeleted`/`isTrashed` flags exist. Ticket behaviour after contact deletion is **[U]** |
| Anonymous / unknown requester | `contactId` is mandatory on ticket creation [V], but contacts can lack an email (social/phone channels). `requesterName` falls back to phone/handle or null |
| No account | Many contacts have none. The schema comment says Customer is "account/company-only" with `customerId: null` otherwise (Zendesk precedent), whereas Intercom falls back to a contact-keyed customer. **Recommend: account-or-null** and record the choice in N7.1 |

---

## 9. Provider-specific limitations

| Capability | Status | Workaround | Impact on Elapsed |
|---|---|---|---|
| OAuth (read-only) | Supported | DC selection in connect; derive Desk host from DC, not `api_domain` | Provider-owned connect code only |
| Incremental query | Supported (search `modifiedTimeRange`) | Windowed ≤5,000 results | Backfill and poll must use search, not list |
| Webhooks | **Partial**: Professional+ only; 5 s ack; GET validation; no retry/dedup/order guarantees | Polling baseline; webhook as later accelerator with JWT + refetch | `webhooks:false` for N7; no freshness regression vs Intercom |
| Webhook auth | JWT only, no shared secret; body unsigned | Verify JWT; treat payload as a hint | No intermediary needed |
| Previous state | Supported via history (before/after) | — | None |
| Resolved vs Closed | **Not supported** | Closed → `resolved` | None (documented mapping) |
| Pending-customer vs internal | **Partial** (On Hold only; custom statuses) | On Hold → `pending_customer` | Policy-pause semantics for "waiting on third party" are imperfect |
| Priority "urgent" | Not supported by system values | Pass custom values through | Policies matching `urgent` never match Zoho cases unless custom values are mapped |
| Tags | Not inline | Omit | No tag-based policy conditions |
| Event ordering | Second-precision; history order undocumented | `sourceSequence` from a deterministic sort | Same class of tie-breaking as Zendesk/Intercom |
| Auto-reply vs human reply | **[U]** | History `actor.type`; spike | Could corrupt First Response. See §7 |
| Deletion detection | No documented trashed listing | Webhook (Pro+) or by-id revalidation | Extra credits; otherwise false-open cases |
| API budget | Credits + concurrency, **shared with the customer's other tools**, edition-scaled; Free = 5,000/day | Windowed backfill, quota guard, concurrency 1–2 | Large portals cannot be fully imported; 90-day window only |
| Rate-limit signalling | `Retry-After` only on daily exhaustion; concurrency 429 has none | Map daily exhaustion to `ProviderUnavailableError` so N3's breaker backs off; rely on exponential backoff otherwise | Small client-level addition |
| Jira/Linear linkage | **[U]**: Zoho's Jira integrations are an extension and a third-party app (MYBytes, "Zoho Desk for Jira"); the linking mechanism (remote link vs custom field vs panel) is not documented in what I could read. Elapsed's Jira correlator reads Jira **remote links** | Spike with a real sandbox; add a fixture | Without a URL Jira exposes, the `zoho_desk + Jira` matrix pair (N7.5) cannot pass honestly. **Risk to N7 acceptance, not to the core** |
| Archived tickets | Separate endpoint; history availability **[U]** | Ignore old closed tickets outside the window | Low |
| Provider-specific core logic | **None identified** | | Core, commitments, notifications and projector stay untouched |

---

## 10. Factual comparison (no ranking)

Zendesk and Intercom columns are taken from this repo's adapters; I did **not** re-verify their vendors' rate-limit numbers in this task.

| Capability | Zendesk | Intercom | Zoho Desk |
|---|---|---|---|
| OAuth | Yes, read scope, per-org client, per-subdomain | Yes, per-org client, no refresh dance | Yes, read-only scopes, per-org client, **per-DC** accounts server, 1 h access tokens, refresh keeps the same refresh token |
| Ticket ingestion | Incremental export + per-ticket audits | `conversations/search` + per-conversation fetch | `tickets/search` windowed + per-ticket threads and history |
| Incremental sync | `start_time` / `end_time` cursor | `updated_at >` with `starting_after` | `modifiedTimeRange` windows; **bump-on-reply [U]** |
| Webhooks | Yes (Bearer token, ticket-id hint) | No (`webhooks:false`) | Yes on Professional+ only; JWT; 5 s ack; N7 baseline = none |
| Comments / threads | Public comments in audits | `conversation_parts` | Threads (public/private, direction, status) and separate internal comments |
| Previous state | Yes, audit `previous_value` | No (state replayed from parts) | Yes via history; webhook `prevState` is optional |
| Requester identity | `requester_id` + users sideload (roles) | Contact via `source.author`/contacts | `contact` on the ticket (+ author types on threads) |
| Customer / account | `organization_id` → org | Contact → company, else contact | `accountId` / `contact.account`; may be null |
| Historical backfill | 90 d default, resumable | 90 d default, resumable | 90 d window, **credit-metered**, quota-aware |
| Rate limits | 429 retried by `fetchWithRetry` | 429 retried by `fetchWithRetry` | Daily credits + concurrency, shared per portal; `Retry-After` only on exhaustion |
| Reconciliation | Same incremental export + hourly full re-derive; deletions in export | Same cursor poll; no deletion signal | Same pattern via search; deletions need by-id or webhook |
| SLA-relevant state | 6 statuses (new/open/pending/hold/solved/closed) + priority changes | 3 states (open/snoozed/closed) | 3 status types (open/on hold/closed) + custom status names; priority transitions in history |

---

## 11. Decision criteria

| # | Criterion | Result |
|---|---|---|
| 1 | OAuth connection workable | **Met** (per-DC handling; Desk base URL must not come from `api_domain`) |
| 2 | Required ticket data normalizable | **Met** (tags omitted, as Intercom) |
| 3 | Requester/customer normalizable | **Met** (account-or-null) |
| 4 | Webhooks or another reliable incremental mechanism | **Met via polling**; bump-on-reply must be confirmed [U] |
| 5 | Missed events reconcilable | **Met** (overlap + by-id fallback) |
| 6 | Historical backfill feasible | **Met for a bounded window**; not for full history of large portals |
| 7 | API limits manageable | **Met with a quota guard**; tight on Free/Express/Standard for large helpdesks |
| 8 | State semantics sufficient for SLA evaluation | **Met with mapping decisions**; auto-reply classification [U] |
| 9 | Fits N2 contract without weakening core | **Met**: no core change identified |
| 10 | Edition limits acceptable | **Met for polling** (works on every edition); webhooks Pro+ only; Free budget is marginal |

---

## 12. Required implementation changes (all inside the N7.4 allow-list; none in the contract or core)

1. `IntegrationProvider` += `zoho_desk` (migration); entries in `apps/worker/src/providers.ts` and `apps/web/src/lib/providers.ts`; `app/api/integrations/zoho-desk/{connect,callback,config,disconnect,backfill}`; settings card; `lib/zoho-desk-env.ts`.
2. New `packages/zoho-desk` mirroring `packages/intercom` (client, oauth, tokenLifecycle, backfill, rawEvents, normalize, hash, types, ticket-url).
3. Client: DC → Desk-host table; optional `orgId` header; `fetchWithRetry` with `isRetryableStatus: 429`; read `X-Rate-Limit-Remaining-v3`; map daily-credit exhaustion to `ProviderUnavailableError`.
4. Store status-field metadata and the agent list as RawEvents so normalization is replayable.
5. `recognizeCaseUrl` for `…/support/{portal}/ShowHomePage.do#Cases/dv/{id}` (fragment id; the org's own host or custom domain only; reject lookalikes and other tenants).
6. Capabilities set honestly: `webhooks:false`, `policyImport:false`, `calendarImport:false`, `incrementalNormalization:false`, `replyEvents:true`, `priorityChanges:true` (history carries it) or `false` if skipped, `officialLinks:false`.
7. Record the status mapping in plan §6.

**No contract gap found.** The `verifyWebhook(req, secret)` shape, `normalize(ctx)`, `CaseFacts` optionality and `recognizeCaseUrl(url, credentials)` all fit. I recommend **no change** to `@sla/ingestion`.

---

## 13. Decision

### CONDITIONAL GO

**Why.** Every functional requirement can be met with documented capabilities: OAuth with offline refresh, a modification-time search for incrementals, per-ticket threads and history with before/after status values, embedded contact/account data, and a documented On Hold pause. Webhook limitations (edition gating, 5 s ack, no ordering across modules, JWT-only) do not matter because Elapsed already treats webhooks as hints over a polling safety net. No new domain state and no core, projector or contract change is required. The real costs are operational: API credits are metered, shared with the customer's own tooling and sized by edition, so Zoho needs a windowed, quota-aware backfill rather than a full-history import.

**Blocking limitations.** None technical identified. Two things block *closing D29*:

- **Governance:** Zoho Desk is not among the D29 candidates and has one recorded prospect against the required two (§0).
- **Unverified items that can flip the verdict** (kill criteria for N7.1):
  1. Workflow auto-replies cannot be distinguished from human replies → **NO-GO** (would corrupt First Response).
  2. `modifiedTime`/search surfaces neither agent replies nor status changes, *and* the by-id fallback exceeds a Standard-edition credit budget → **NO-GO** for typical tenants.
  3. No usable Jira or Linear linkage surface → N7.5 cannot honestly pass, so re-scope or pick another provider (core unaffected).

**Accepted limitations.** Polling-only freshness at launch; no Zoho SLA or business-hours import (native policies); no tags; Closed→`resolved`, On Hold→`pending_customer`; no `urgent` priority; 90-day windowed backfill with a quota guard; deletion detection via by-id revalidation; webhooks only on Professional+ and only later.

**Required implementation changes.** §12.

### D29 recommendation

```
D29 = Zoho Desk, conditional on:
  (a) ≥ 2 recorded customers or qualified prospects on Zoho Desk (the roadmap's own rule;
      currently 1, unqualified). Zoho Desk must also be added to the D29 candidate list
      deliberately, since it is not on it today; and
  (b) the N7.1 spike, on a Zoho sandbox, confirming the five [U] items:
      1. modifiedTime / search coverage of replies, status changes and trash;
      2. auto-reply vs human-reply classification via history actor type;
      3. Desk base host and webhook-scope names (api_domain contradiction);
      4. history ordering and `PENDING` thread semantics;
      5. how Zoho's Jira integration exposes a ticket link to Jira.
```

If (a) is not met, the plan's own text applies: record in the roadmap that N7 does not start. This document does **not** choose another provider; Freshdesk, Pylon and HubSpot remain the listed candidates and none was evaluated here.

---

## 14. Sources

Official Zoho documentation (primary):

- Zoho Desk API Documentation (introduction, pagination, API credits, concurrency, rate-limit headers, authentication, scopes, data centers, organization binding, Tickets, Search Tickets, Get Ticket History, Threads, Comments, Contacts, Fields): <https://desk.zoho.com/DeskAPIDocument>
- Zoho Desk Webhook Documentation (events, payload, prevState, JWT `X-ZDesk-JWT`, JWKS, 5 s/410 semantics, edition limits, webhook APIs): <https://desk.zoho.com/support/WebhookDocument.do>
- Events Supported in the Zoho Desk Get Ticket History API: <https://help.zoho.com/portal/en/kb/desk/developer-space/rest-apis/articles/events-supported-in-get-ticket-history-api>
- On Hold Ticket State (SLA pause, fall-back on requester reply, custom ON HOLD statuses): <https://help.zoho.com/portal/en/kb/desk/ticket-management/ticket-status/articles/on-hold-state-use-cases-and-behavior>
- Zoho OAuth 2.0: [authorization](https://www.zoho.com/accounts/protocol/oauth/web-apps/authorization.html), [access token](https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token.html), [refresh](https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token-expiry.html), [multi-DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html), [token limits](https://www.zoho.com/accounts/protocol/oauth/token-limits.html), [scope](https://www.zoho.com/accounts/protocol/oauth/scope.html)

Secondary, used only for context: [Zoho Desk for Jira (MYBytes, third-party, Atlassian Marketplace)](https://marketplace.atlassian.com/apps/1234529/zoho-desk-for-jira). A Zoho community thread on rate limits was read and **not** relied on.

Repo evidence: `implementation-plans/02-provider-contract-and-projector.md`, `07-third-ticket-source.md`, `ROADMAP_Product.md` (D29, N7), `packages/ingestion/src/{contract,projector,pipeline,errors}.ts`, `packages/{zendesk,intercom}/src/*`, `packages/core/src/{types,ordering,clock-rules,evaluate}.ts`, `packages/http-retry/src/retry.ts`, `apps/web/src/app/api/webhooks/zendesk/[integrationId]/route.ts`, `plans/target-list.csv`.
