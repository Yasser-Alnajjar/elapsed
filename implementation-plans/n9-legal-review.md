# N9 — Terms and Privacy text for legal review

> **LEGAL REVIEW OUTSTANDING. Not published, not legally approved.** This file is a proposal for the reviewer. `TermsView` and `PrivacyView` were deliberately **not** edited (plan 09, Appendix A).

| Document | Today | Proposed addition | Facts to verify |
| --- | --- | --- | --- |
| Terms (`TermsView`, line 11) | "...such as Zendesk, Intercom, Jira, Linear, and GitHub..." | "...such as Zendesk, Intercom, Jira, Linear, GitHub, or a custom REST API that you configure..." | Customers configure the API address and credentials themselves; Elapsed only sends read requests. |
| Privacy (`PrivacyView`, line 5) | names the five providers | Add the custom source; state that Elapsed stores only the fields the customer maps (and message text only if a body field is mapped), that credentials are encrypted at rest, and that a customer can disconnect at any time (data kept, hidden, per the existing soft-disconnect behavior). | `packages/custom-ticket/src/projection.ts` (whitelist projection, 64 KB cap), `packages/db/src/custom-secrets.ts`; retention of raw snapshots is undecided (H-5). |
| Marketing/plan copy (`packages/db/src/plans.ts`, README, FAQ, `ConnectSourceStep`) | "Zendesk, Intercom" only | "or a Custom REST source (Beta)". Held back until Beta is enabled for a first organization; `pricing-plans.test.ts` asserts the current wording and must change in the same step (on `testing`). | Beta enablement requires the plan 09 section 6.10 benchmark report. |

---

# Review package for the legal reviewer (prepared 2026-10-10)

> **Status: prepared for review. NOT reviewed, NOT approved.** Prepared by an engineering assistant from the repository, not by legal counsel. Nothing in this section is legal advice or a legal conclusion. The live `TermsView` and `PrivacyView` files are unchanged. D-07 (validation master) stays **BLOCKED (BL-09)** until a qualified reviewer records a decision on each clause below.

## 1. What the reviewer is asked to decide

1. Approve, change or reject each **proposed addition** in section 3 (Terms, Privacy, marketing copy).
2. Rule on the **existing-copy conflicts** in section 4. Two of them (L-01 and L-02) are about copy that is already live and not specific to the Custom REST source.
3. Answer the **open questions** in section 5.
4. Record the decision per clause in section 6 (reviewer, date, approved / changed / rejected).

Editing the live Terms and Privacy is a separate engineering change made only after section 6 is filled in (plan 09 Appendix A).

## 2. Verified facts the draft copy relies on

Each row names where it was checked on 2026-10-10 (branch `claude/sharp-euler-gm4not`, includes `origin/main` 1b1e084). A fact marked **not verified** must not be stated to customers.

| # | Fact | Where verified | State |
| --- | --- | --- | --- |
| F-1 | The customer enters the base URL and credentials; Elapsed connects only to that origin (HTTPS, port 443, public addresses; redirects, userinfo, other origins refused). | `packages/safe-http/src/url.ts`, `client.ts`; tests in `packages/safe-http/test/` (D-08) | Verified in code and tests |
| F-2 | Elapsed sends `GET` requests. A `POST` is allowed only to an endpoint the customer designates as a read-only search/query, confirmed by an explicit setting. Elapsed has no code path that sends `PUT`, `PATCH` or `DELETE` (the client refuses any method other than GET/POST). | `packages/custom-ticket/src/schema.ts` (request `method`, read-only POST confirmation); `client.test.ts` ("other methods" refused) | Verified. **The proposed Terms/Privacy wording "only sends read requests" must account for POST (L-03).** |
| F-3 | Whether a customer's own POST endpoint is really read-only is the customer's assertion; Elapsed cannot verify it. | design (`schema.ts`) | Verified as a limitation |
| F-4 | Stored data is a whitelist projection of the fields the customer maps, at most 64 KB per payload; unmapped fields (emails, phone numbers, attachments, internal notes) are not stored. Message text is stored only if a body field is mapped. | `packages/custom-ticket/src/projection.ts`; plan 09 §7; the mock's `internal_notes` never appears in stored payloads (E2E B-09/B-10) | Verified |
| F-5 | Sample responses (setup wizard) are held in memory and returned to the owner's browser; they are not stored server-side. | plan 09 §7 "Samples"; B-10 response checks (no stored sample found) | Verified by design and by B-10 database scan; **no dedicated test** of the sample route's non-persistence |
| F-6 | Credentials are encrypted at rest (AES-256-GCM, bound to organization, integration and field), never returned to the browser (only "set / not set"), and kept out of logs, sync history and error messages. | `packages/db/src/custom-secrets.ts`; `packages/db/test/custom-secrets.test.ts` (D-08); B-10 (database, logs, API responses) | Verified (B-10's browser Network check was not done) |
| F-7 | Rotating `INTEGRATION_TOKEN_ENCRYPTION_KEY` makes all custom credentials unreadable until owners re-enter them. | `custom-secrets.ts` header; plan 09 §8.4, Q16 | Verified; documented limitation (N8-S7) |
| F-8 | Disconnect is a soft disconnect: credentials cleared, status `disconnected`, data and configuration versions kept and hidden from the customer's views. It is not deletion. | plan 09 §7 "Disconnect"; `packages/db/src/integration-visibility.ts` | Verified in plan; **retention behavior after disconnect is undecided (H-5)** |
| F-9 | Raw events are append-only; superseded snapshots are not pruned; there is no automatic expiry of stored raw data. | plan 09 §7 "Pruning"; `docs/data-retention-and-on-call.md` | Verified |
| F-10 | Sync-run history is kept 30 days; unactivated drafts and their secrets expire after 14 days. | plan 09 §7 | Stated in plan; **cleanup job existence not re-verified here** |
| F-11 | The source is polled (active poll about 5 minutes, full reconciliation about 30 minutes); there is no inbound webhook. | plan 09 Appendix A; `worker_settings` | Verified |
| F-12 | Customer-controlled content (ticket text, customer names) may contain personal data about the customer's own end users. Elapsed stores only mapped fields. | design; F-4 | Verified in design |
| F-13 | The platform operator can enable Custom REST per organization (allowlist) and can pause it; the source is "Beta". | D33/D33-A1; B-13, B-15 | Verified |
| F-14 | Errors reported to the monitoring service (Sentry) carry fixed codes and are scrubbed; no credentials or URLs. | `sentry-scrub.test.ts`; plan 09 §8.4 | Verified in tests for existing scrubbing; **custom-specific scrub coverage is not separately tested** |
| F-15 | Elapsed's outbound IPv4 address for Custom REST requests is the production host's Elastic IP **13.62.74.24** (web and all three worker replicas), verified 2026-10-10; no IPv6 egress. It is also the application's public address. The address is stable while the Elastic IP stays allocated; there is no stated stability or change-notice commitment. | owner-run host checks and AWS CloudShell (decision sheet, O-2 record) | **Verified 2026-10-10** (A5 security-group review open) |
| F-16 | Raw events (including the `ticket_deleted:` marker written when a customer's system answers 404 for a ticket) are append-only and have no expiry or purge job. A deletion marker is permanent in V1: a ticket restored at the source stays hidden in Elapsed. Elapsed does not delete raw events on request. | `docs/data-retention-and-on-call.md`; plan 09 §6.5, §7; `docs/custom-provider-deletion-recovery.md` (2026-10-10) | Verified. Bears on L-01/L-02 and on any erasure promise (Q-1) |
| F-17 | During the Beta, one custom source is limited to 1,000 live tickets (a provisional safeguard, owner decision OD-08, 2026-10-10); a source over the limit stops syncing with a specific message and existing data stays visible. A large deletion reported by the source also stops syncing until fixed at the source. These are product limits, not commitments, and should not be restated as service levels in the Terms. | plan 09 §6.4, §2.1 (OD-08, U2); `state-copy.ts` | Verified in code and tests (2026-10-10). Reviewer to confirm that no uptime or completeness promise is implied |

## 3. Proposed additions (verbatim; for the reviewer to approve, change or reject)

These are the existing proposals, restated with the facts they depend on. The reviewer may reword them.

| Id | Document | Today | Proposed | Depends on |
| --- | --- | --- | --- | --- |
| P-1 | Terms §2, first sentence (`TermsView.tsx` line 11) | "…such as Zendesk, Intercom, Jira, Linear, and GitHub…" | "…such as Zendesk, Intercom, Jira, Linear, GitHub, or a custom REST API that you configure…" | F-1 |
| P-2 | Terms §2, second paragraph ("read-only against every connected data source") | "The Service is read-only against every connected data source. It does not create, modify, or delete tickets…" | **Needs reviewer wording** (see L-03): suggested engineering text, for the reviewer to accept or replace: "For a custom REST API that you configure, Elapsed sends read requests. A search endpoint that requires the POST method is used only if you designate it as a read-only query; Elapsed never intentionally creates, changes or deletes records in your system." | F-2, F-3 |
| P-3 | Terms §3 (connected integrations) | credentials responsibility text | Add: "For a custom REST API, you supply the address and credentials and you are responsible for the permissions those credentials carry. We recommend read-only credentials." | F-1, F-3 |
| P-4 | Privacy §1 "What we collect" (`PrivacyView.tsx` line 5) | names five providers and Slack | Add the custom source; state that Elapsed stores only the fields you map, and message text only if you map a body field. | F-4 |
| P-5 | Privacy §2 "What we don't collect" | "We never write to a connected system…" naming five providers | Extend to the custom source with the POST qualification of P-2. | F-2 |
| P-6 | Privacy (security / credentials) | "encryption in transit, access controls…" | Add: "Credentials you enter for a custom REST API are encrypted at rest, are not shown again, and are removed from logs and error reports." | F-6 |
| P-7 | Privacy (disconnect) | "If you disconnect an integration… data … is deleted according to our standard retention schedule." | **Conflicts with the implementation (L-02);** do not extend until the reviewer and owner decide. | F-8, F-9 |
| P-8 | Marketing / plans copy (`plans.ts`, README, FAQ, `ConnectSourceStep`) | "Zendesk, Intercom" only | "or a Custom REST source (Beta)". Held until Beta is enabled for a first organization; `pricing-plans.test.ts` asserts today's wording and changes in the same step on `testing`. | N9.14 |
| P-9 | Beta wording (new) | none | A reviewer-supplied statement of what "Beta" means contractually (availability, support, data handling, changes). Engineering has no proposed text. | F-13 |

## 4. Issues found in the existing live copy and in the draft (for the reviewer and the owner)

These are findings, not changes made. Live files were not edited.

| Id | Where | Finding | Evidence | Needs |
| --- | --- | --- | --- | --- |
| **L-01** | `PrivacyView.tsx` §4 "Data retention" | The live text says: "Historical data is retained for 90 days from the date each integration is connected. This window is fixed…" and covers raw data, normalized events, cases and commitments. The repository documents the opposite: "There is no per-plan retention window in the schema or code… data is retained until you ask us to remove it" and raw events are never pruned. A custom source's own `importWindowDays` (1 to 365, default 90) only limits what is imported at first, not how long data is kept. | `docs/data-retention-and-on-call.md` lines 27 to 30 and 96 to 101; `schema.ts` line 326; plan 09 §7 | **Owner and counsel.** Likely an inaccurate public statement for every provider. Resolve H-5 or change the copy; not a Custom-REST-only issue. |
| **L-02** | `PrivacyView.tsx` §4, second paragraph | "If you disconnect an integration or close your account, data associated with it is deleted according to our standard retention schedule." The implemented disconnect is soft (data kept and hidden); removal is a manual operator action. No scheduled deletion was found. | F-8, F-9; `docs/data-retention-and-on-call.md` | Owner and counsel. Same decision as L-01. |
| **L-03** | `TermsView.tsx` §2 and `PrivacyView.tsx` §2; draft `n9-legal-review.md` table (row "Facts to verify") | "Read-only against every connected data source" and the draft's "Elapsed only sends read requests" are not accurate as written for the custom source: a customer-designated POST search endpoint is permitted. The customer-guide draft (plan 09 Appendix A) already carries the qualification; the Terms and Privacy drafts above do not. | F-2, F-3 | Counsel (wording). Engineering fact is settled. |
| L-04 | Terms §3 | "Disconnecting stops new data from being read; it does not retroactively delete data already stored, which is subject to the retention terms below." This is consistent with the implementation but points to a retention section that currently says 90 days (L-01). | F-8 | Resolved by L-01. |
| L-05 | Privacy §5 (subprocessors) | Subprocessors are described generically ("cloud hosting and email delivery providers"). The error-monitoring service (Sentry) and Slack are not named. Not specific to Custom REST. | `PrivacyView.tsx` §5; plan 09 §8.4 (Sentry) | Counsel. |
| L-06 | Appendix A draft (customer guide) | "Elapsed never creates, edits or deletes anything in your ticket system" is a promise about the customer's POST endpoint that Elapsed cannot enforce (F-3). | F-3 | Counsel; consider "does not intentionally". |

## 5. Open questions for counsel

- **Q-1 Roles.** For fields a customer maps from its own ticket system (which may contain its end users' names, identifiers and message text), is Elapsed a processor, and is a data-processing addendum needed before Beta? Which existing terms cover it?
- **Q-2 Credentials liability.** Customers may enter high-privilege credentials despite the recommendation to use read-only ones. What allocation of responsibility and what notice is appropriate in Terms §3?
- **Q-3 Beta terms.** What should "Beta" mean contractually (no uptime commitment, features may change or be withdrawn, data handling)? Is a separate Beta addendum needed (P-9)?
- **Q-4 Retention statement (L-01, L-02).** Which retention and deletion statement can be made today, given the implemented behavior, and what must change before Custom REST data is accepted?
- **Q-5 Outbound IP (F-15).** Update 2026-10-10: the owner decided to provide a fixed address and it turned out to exist already and to be verified (Elastic IP 13.62.74.24, F-15). Question to the reviewer: what may be stated to customers about it, and is a change-notice or stability commitment wanted or advisable (wording W-3 in the decision sheet)?
- **Q-6 Third-party terms.** Does reading a customer's third-party helpdesk through its API with the customer's credentials require anything from Elapsed beyond the customer's own authority statement in Terms §3?
- **Q-7 Samples.** Is it acceptable to describe sample responses as "not stored" given they pass through Elapsed's servers in memory (F-5)?

## 6. Decision record (to be filled in by the reviewer; do not pre-fill)

| Clause | Reviewer (name, role) | Date | Approved / Changed / Rejected | Final wording or reference |
| --- | --- | --- | --- | --- |
| P-1 | | | | |
| P-2 | | | | |
| P-3 | | | | |
| P-4 | | | | |
| P-5 | | | | |
| P-6 | | | | |
| P-7 | | | | |
| P-8 | | | | |
| P-9 | | | | |
| L-01, L-02 (retention) | | | | |
| L-03 | | | | |
| L-05 | | | | |

## 7. Hand-over instructions

> Update 2026-10-10: the owner decisions that the reviewer's answers depend on are RECORDED (details, implications and proposed wording W-1 to W-3 in `n9-legal-decision-sheet.md`): **O-1 Option A** (align retention wording to the implemented behavior; no purge), **O-2 Option B** (fixed outbound IP: infrastructure work NOT yet done or verified, F-15 stays accurate until it is), **O-3 Option A** (POST support stays; wording must not imply POST is read-only). **Qualified legal review remains PENDING**; section 6 below stays empty until a reviewer fills it.

1. Send this file, `apps/web/src/modules/marketing/legal/csr/TermsView.tsx`, `PrivacyView.tsx`, `docs/data-retention-and-on-call.md` and plan 09 §7 and Appendix A to the reviewer.
2. The reviewer fills in section 6 (or replies per clause).
3. Engineering then edits the live files in one change, with `pricing-plans.test.ts` updated on `testing` for P-8, and records the result in validation master D-07.
4. L-01 and L-02 are independent of Custom REST and may be handled sooner.
