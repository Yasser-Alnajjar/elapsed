# N9 — Terms and Privacy text for legal review

> **LEGAL REVIEW OUTSTANDING. Not published, not legally approved.** This file is a proposal for the reviewer. `TermsView` and `PrivacyView` were deliberately **not** edited (plan 09, Appendix A).

| Document | Today | Proposed addition | Facts to verify |
| --- | --- | --- | --- |
| Terms (`TermsView`, line 11) | "...such as Zendesk, Intercom, Jira, Linear, and GitHub..." | "...such as Zendesk, Intercom, Jira, Linear, GitHub, or a custom REST API that you configure..." | Customers configure the API address and credentials themselves; Elapsed only sends read requests. |
| Privacy (`PrivacyView`, line 5) | names the five providers | Add the custom source; state that Elapsed stores only the fields the customer maps (and message text only if a body field is mapped), that credentials are encrypted at rest, and that a customer can disconnect at any time (data kept, hidden, per the existing soft-disconnect behavior). | `packages/custom-ticket/src/projection.ts` (whitelist projection, 64 KB cap), `packages/db/src/custom-secrets.ts`; retention of raw snapshots is undecided (H-5). |
| Marketing/plan copy (`packages/db/src/plans.ts`, README, FAQ, `ConnectSourceStep`) | "Zendesk, Intercom" only | "or a Custom REST source (Beta)". Held back until Beta is enabled for a first organization; `pricing-plans.test.ts` asserts the current wording and must change in the same step (on `testing`). | Beta enablement requires the plan 09 section 6.10 benchmark report. |
