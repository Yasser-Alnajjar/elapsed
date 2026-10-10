# N9 legal decision sheet (one page for the qualified reviewer)

> **NOT reviewed, NOT approved. Prepared by engineering, not legal advice.** Live `TermsView.tsx` and `PrivacyView.tsx` are unchanged. Facts and evidence for every row: `n9-legal-review.md` (F-1 to F-17, P-1 to P-9, L-01 to L-06, Q-1 to Q-7). Fill the Decision column and return; engineering then makes one copy change (plan 09 Appendix A).

Three separate things: **Part A** is for the owner (O-1 to O-3, engineering recommendations given). **Part B** needs a qualified legal reviewer; engineering may not decide it. L-01/L-02 and Q-5 depend on O-1 and O-2, so decide Part A first. D-07 is closed only when Part B is recorded in section 6 of `n9-legal-review.md` by the reviewer.

## A. Owner decisions (no lawyer needed; made first, they fix the facts the clauses state)

**Status: O-1, O-2 and O-3 are PENDING. The recommendations below are engineering proposals, not decisions; none is treated as made until the owner confirms it explicitly (recorded in validation master §2.4). The qualified legal review in Part B is a separate required gate and is not satisfied by Part A.**

| # | Decision | Recommendation |
| --- | --- | --- |
| O-1 | Retention: align the **copy** to the implemented behavior (no expiry), or **build** a purge | Align the copy now. A purge conflicts with the append-only replay log and is H-5 work; do not build it for the pilot |
| O-2 | Egress IP: will Elapsed provide a fixed address? | State "not fixed" in the guide for the pilot; revisit if a design partner requires allowlisting |
| O-3 | Keep POST search endpoints, or restrict to GET in V1 | Keep POST with the P-2 wording; it is needed by real helpdesk APIs and is read-only by customer design |

## B. Clauses that need the qualified reviewer's decision

| Clause | Needed to start the Beta pilot? | Engineering recommendation (a proposal, not a ruling) | Decision (Approve / Change / Reject) |
| --- | --- | --- | --- |
| P-1 Terms §2: name the custom REST source | Yes | Approve as drafted | |
| P-2 / L-03 "read-only" wording | Yes | Replace "read-only against every connected data source" with "Elapsed reads from connected sources; for a custom REST API the customer may designate a search endpoint that uses POST, which Elapsed uses only to read" (F-2, F-3) | |
| P-3 Terms §3 credentials responsibility | Yes | Approve; recommend read-only credentials (Q-2) | |
| P-4 Privacy §1 what we collect | Yes | Approve: only mapped fields; message text only if a body field is mapped | |
| P-5 Privacy §2 what we don't collect | Yes | Approve with the P-2 qualification | |
| P-6 Privacy credentials security | Yes | Approve (F-6 verified in tests) | |
| P-9 Beta wording | Yes | Short Beta addendum: no uptime commitment, features may change, 1,000-live-ticket limit is a product limit not a promise (F-13, F-17) | |
| L-01 / L-02 retention and deletion on disconnect | Yes, for custom data (live copy already conflicts with behavior) | State what is true: raw events and cases are kept until the organization is removed; no 90-day purge exists; disconnect stops reading and keeps data (F-8, F-9, F-16). Do not promise erasure on request | |
| P-7 extend the disconnect sentence | No (blocked by L-02) | Hold until L-02 is decided | |
| L-05 name Sentry and Slack as subprocessors | No | Reviewer's call; independent of Custom REST | |
| P-8 marketing / plans copy "or a Custom REST source (Beta)" | No (held until a first organization is enabled) | Approve after the pilot starts | |
| Q-1 processor role, DPA before Beta | Yes (answer) | Reviewer to say whether a DPA is required for the pilot customers | |
| Q-5 outbound IP disclosure | Yes (answer) | If no fixed egress IP will exist, say so in the setup guide | |

## C. What stays blocked without the reviewer

Any live Terms or Privacy edit, the marketing copy (P-8), and the D-07 pass. Everything else for the pilot is engineering-complete (see validation master Checkpoint B).
