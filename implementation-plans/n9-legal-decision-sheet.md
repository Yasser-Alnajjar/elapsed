# N9 legal decision sheet (one page for the qualified reviewer)

> **NOT reviewed, NOT approved. Prepared by engineering, not legal advice.** Live `TermsView.tsx` and `PrivacyView.tsx` are unchanged. Facts and evidence for every row: `n9-legal-review.md` (F-1 to F-17, P-1 to P-9, L-01 to L-06, Q-1 to Q-7). Fill the Decision column and return; engineering then makes one copy change (plan 09 Appendix A).

Three separate things: **Part A** is for the owner (O-1 to O-3, engineering recommendations given). **Part B** needs a qualified legal reviewer; engineering may not decide it. L-01/L-02 and Q-5 depend on O-1 and O-2, so decide Part A first. D-07 is closed only when Part B is recorded in section 6 of `n9-legal-review.md` by the reviewer.

## A. Owner decisions (no lawyer needed; made first, they fix the facts the clauses state)

**Status: O-1, O-2 and O-3 are PENDING. The recommendations below are engineering proposals, not decisions; none is treated as made until the owner confirms it explicitly (recorded in validation master §2.4). The qualified legal review in Part B is a separate required gate and is not satisfied by Part A.**

### Owner decision record (all three PENDING; nothing below is approved)

Each block: the proposal, what it implies, the exact decision needed, and a sign-off line the owner fills in. Engineering records an option as decided only after the owner writes it here or confirms it in chat. Source facts: `n9-legal-review.md` F-8, F-9, F-15, F-16, L-01, L-02, L-03.

**O-1 Retention statement (affects Privacy §4, L-01/L-02, P-7)**

| | |
| --- | --- |
| Situation | Live Privacy §4 promises a fixed 90-day retention and deletion "according to our standard retention schedule" on disconnect or account closure. The implementation keeps raw events, cases and evaluations with no expiry and has no purge job; disconnect stops reading and keeps data (F-8, F-9, F-16) |
| Option A (proposed) | Align the **copy** to the implemented behavior (data kept until the organization is removed; disconnect stops reading and keeps data; no erasure-on-request promise). The wording itself goes through the qualified reviewer (Part B) before any live edit |
| Option B | **Build** a retention purge so the current copy becomes true |
| Implications of A | No engineering work. Existing customers' live promise is changed, so the reviewer must approve the new wording and the change may need customer notice. Honest, and consistent with the append-only replay log |
| Implications of B | Large: conflicts with append-only raw events and D24 replay, needs H-5 design, a migration and backups policy, and delays Beta. Not required for a one or two partner pilot |
| Decision needed | Choose **A** or **B** (or state another course) |
| Owner sign-off | Decision: ______  Date: ______  Name: ______ |

**O-2 Outbound IP address (affects Q-5, F-15, the setup guide)**

| | |
| --- | --- |
| Situation | Elapsed's egress IP for customer API calls is not fixed or documented (F-15). A customer that allowlists IPs cannot be given an address |
| Option A (proposed) | Say in the setup guide and Beta terms that the address is **not fixed** for the pilot; choose pilot partners that do not require IP allowlisting |
| Option B | Provide a **fixed egress address** (infrastructure change: NAT or proxy with a static IP) before Beta |
| Implications of A | Documentation only; a partner needing allowlisting cannot join until B exists. The reviewer decides whether a disclosure is required (Q-5) |
| Implications of B | Infrastructure work and cost, a production change that needs its own deployment approval; then publish the address and commit to change notice |
| Decision needed | Choose **A** or **B** |
| Owner sign-off | Decision: ______  Date: ______  Name: ______ |

**O-3 POST search endpoints in V1 (affects P-2, P-5, L-03)**

| | |
| --- | --- |
| Situation | The client sends GET or POST. A customer may designate a POST search endpoint. Live Terms/Privacy say the service is "read-only against every connected data source", which is not literally true for a POST request (L-03, F-2, F-3) |
| Option A (proposed) | **Keep POST** in V1 and have the reviewer approve wording that says Elapsed reads from connected sources, and for a custom API uses a customer-designated POST search endpoint only to read |
| Option B | **Restrict V1 to GET** (code change to the schema and validation, tests, and plan 09 amendment), so "read-only" stays literally true |
| Implications of A | No code change; relies on the customer's endpoint being read-only by design (cannot be enforced, L-06). Real helpdesk APIs often need POST search |
| Implications of B | Code and test change on `main`/`testing`; some customers' APIs cannot be connected; reverses a shipped capability |
| Decision needed | Choose **A** or **B** |
| Owner sign-off | Decision: ______  Date: ______  Name: ______ |

Interlock: Part B clauses P-2/P-5 (O-3), P-7 and L-01/L-02 (O-1) and Q-5 (O-2) are worded after the owner decision; the reviewer should receive this record with the choices filled in. Making O-1 to O-3 does not satisfy Part B.

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

## Handoff to the qualified reviewer (checklist; nothing here is approval)

1. Owner completes O-1 to O-3 above (or tells the reviewer they are open).
2. Send: this sheet, `n9-legal-review.md` (facts F-1 to F-17, proposals P-1 to P-9, issues L-01 to L-06, questions Q-1 to Q-7, decision record section 6), `apps/web/src/modules/marketing/legal/csr/TermsView.tsx` and `PrivacyView.tsx` (read-only; unchanged), `docs/data-retention-and-on-call.md`, plan 09 §7 and Appendix A.
3. The reviewer answers Part B (and Q-1 to Q-7) and records each clause in `n9-legal-review.md` section 6 (name, role, date, approved/changed/rejected, final wording).
4. Only then does engineering edit the live Terms and Privacy in one reviewed change and mark D-07. Until section 6 is filled by the reviewer, D-07 is BLOCKED (BL-09) and no copy changes.

## C. What stays blocked without the reviewer

Any live Terms or Privacy edit, the marketing copy (P-8), and the D-07 pass. Everything else for the pilot is engineering-complete (see validation master Checkpoint B).
