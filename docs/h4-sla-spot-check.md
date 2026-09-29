# H-4 — SLA correctness spot check (dev Zendesk sandbox)

**Run:** 2026-09-29 · **Scope:** the dev environment's connected Zendesk account (`sla-dmeo`), one Elapsed organization, 45 synced tickets (#1–#60), 68 commitments. **This is not the live-tenant check H-4 asks for** (see [Limitations](#limitations)). Nothing was written to Zendesk or to any database; the engine was not changed.

## How the comparison was done

- **Zendesk's own SLA view**, read-only (GET only), per ticket: `GET /api/v2/tickets/{id}/metric_events` (`apply_sla`, `breach`, `fulfill`, `pause`, `activate` for `resolution_time` and `reply_time`), `GET /api/v2/tickets/{id}?include=slas`, `GET /api/v2/slas/policies`, and the business-hours schedules. Zendesk's due time is ticket start + the `apply_sla` target (calendar hours), cross-checked against every `breach` event (all 10 match to the second).
- **Elapsed**: `commitments`, `evaluations` (`elapsedSeconds`, `breachedAt`) and `normalized_events` from the dev database.
- **Tools** (kept for repeat runs): [`h4-zendesk-fetch.ts`](../packages/db/src/scripts/h4-zendesk-fetch.ts), [`compare-resolution.py`](../scripts/h4-compare/compare-resolution.py), [`compare-replies.py`](../scripts/h4-compare/compare-replies.py), [`creation-actor-replay.mts`](../packages/db/h4/creation-actor-replay.mts). The fetched JSON is not committed (ticket content). The compare scripts read `zd.json`, `el.psv` and `ne.psv` exports from the working directory.

Result legend: ✅ match · ⚠️ SEMANTIC = the systems define the rule differently, numbers explained exactly · ⚠️ DATA = artifact of how the dev sandbox was configured · ❌ = Elapsed disagrees with Zendesk and it is not explained by semantics or data.

## Summary

| Area | Compared | Result |
|---|---|---|
| SLA policy, target, due time (Resolution) | 32 tickets under the current policy | **32/32 exact** |
| Breach / met outcome (Resolution) | same 32 | **32/32 agree** |
| Breach time (Resolution) | 10 breached tickets | 9 exact; 1 off by 44 s (pending pause, F2) |
| Elapsed time (Resolution) | same 32 | 21 exact to the second; 11 differ only by Elapsed's `pending_customer` pause (F2) — every one reconciles exactly |
| Next Reply cycles | 9 cycles Zendesk tracked and Elapsed matched | **9/9 exact** (start, target, elapsed) |
| Next Reply on the first customer message of an agent-submitted ticket | 4 tickets | Elapsed tracks it as First Response instead (D5b, expected) |
| First Response | 9 Elapsed commitments after the H-11 fix (13 before) | 1 exact (ticket 27); ticket 1 now present (target differs: policy edited, F3; outcome differs by D5); 7 expected (D5b). **Before the fix: 5 false breaches + 1 missed FR (F1, fixed)** |
| Business hours / calendars / holidays | 0 | **Not covered**: sandbox policy is 24/7 (`business_hours: false`), no schedules, no holidays |
| Engineering / support legs | 0 | **Not covered**: Zendesk has no leg concept, and `leg_spans` is empty in dev |
| Open (not yet finished) commitments, at-risk state | 0 | **Not covered**: all 68 commitments are met or breached |

## Findings

### F1 — `case_created.actor` is derived from the first status change, so the creator flips as audits arrive · **actual Elapsed correctness bug — FIXED (H-11, 2026-09-29)**

> The findings below describe the state at audit time. See [Re-run after the H-11 fix](#re-run-after-the-h-11-fix) for the results after the fix; the tables further down are the **post-fix** First Response/Next Reply comparison (the Resolution table is unchanged by the fix).

`deriveNormalizedEventsForTicket` ([normalize.ts](../packages/zendesk/src/normalize.ts)) sets `case_created.actor` from the author of the ticket's **first status `Change` audit**, not from who created the ticket. When no status change exists yet it falls back to the requester (always the customer). D5b uses that actor to decide whether a First Response clock starts at ticket creation or at the first customer reply.

Replay on real dev data (`creation-actor-replay.mts`), audits available at first ingest vs. all audits:

| Ticket | requester / submitter | actor at first ingest | actor with all audits | Consequence |
|---|---|---|---|---|
| 54, 56, 57, 58, 59 | end-user / **admin** (agent-submitted) | `customer` | `agent` | FR commitment created at ingest with the wrong start, frozen; **5 FR commitments finished `breached` (reply-less close) where Zendesk applied no First Response SLA** |
| 1 | end-user / **end-user** (customer emailed) | – | `agent` (the agent who solved it) | Customer-created ticket is treated as agent-created: **no FR commitment at all; Zendesk did apply one** |

So the error goes both ways: spurious FR breaches (and their alerts) on agent-submitted tickets, and a **missed** FR on customer-created tickets that an agent touched before the first sync. Because an FR commitment is created once and never re-derived, the result depends on ingest timing. Not caused by the dev setup: it reproduces from the ticket/audit shapes Zendesk sends.

**Task (done as H-11):** derive the creation actor from facts fixed at creation, correct existing FR commitments, add regression tests.

### F2 — Elapsed pauses Resolution on `pending_customer`; Zendesk does not · **RESOLVED by H-12 / D30 (2026-09-29): imported Zendesk policies no longer pause on Pending**

> Resolved after the audit: imported policies now mirror Zendesk (migration `20260929120000_imported_policies_do_not_pause_on_pending`); native policies keep the Pending pause. Re-checking the dev dataset with the engine under the corrected policies, Resolution elapsed and breach time match Zendesk on **32/32** comparable tickets (ticket 19 breaches at 11:37:45, as in Zendesk). The stored evaluations of already-finished commitments are unchanged, so the Resolution table below still shows the audit-time numbers. The text that follows describes the finding as audited.

Zendesk emits no `pause` event on `resolution_time` for any of the 15 Pending intervals in the sample, and its `breach` event lands exactly at start + target even when a Pending interval preceded it (ticket 19: Zendesk breach 11:37:45; Elapsed 11:38:29, +44 s = the two Pending intervals). Elapsed pauses Resolution on `pending_customer` by design (`clock-rules.ts`, imported policy `pauseOnStates`; roadmap E-13/1.7), so 11 tickets show a shorter Elapsed elapsed time, each differing by exactly the Elapsed pause length (8 s to 3184 s).

Impact: in this data no outcome flips, but a ticket that spends long in Pending near its target will read **met in Elapsed and breached in Zendesk**. Roadmap risk row "Engine numbers disagree with Zendesk's own SLA view" applies. **Task:** decide whether Resolution should follow Zendesk (no Pending pause) or keep the product rule and document it as a deliberate deviation in `docs/customer-guide.md` §13. This finding is a decision, not a defect in the arithmetic.

### F3 — Sandbox policy history · **test/data issue, with a product limitation worth recording**

The sandbox owner edited/replaced SLA policies while testing. Zendesk applied a since-deleted policy, "Phase 4 Native Test" (targets 1800–43200 s), to tickets 35–45, and applied **no** Resolution SLA to tickets 1 and 33. Elapsed backfilled these tickets on 2026-09-28 and evaluated them all against the current policy, so their targets and due times differ (ticket 45 reads breached in Elapsed and met in Zendesk). This is not an engine error: Elapsed only ever had the current policy. It does show that a backfill of already-finished tickets cannot reproduce Zendesk's historical policy application. Excluded from the pass rate above.

### F4 — First Response on agent-submitted tickets (D5b) · **expected, decided**

For 7 tickets (21, 26, 32, 45, 46, 47, 48) Zendesk fulfils reply instance 1 at creation and tracks the first customer message as **Next Reply** (target 40 min for normal). Elapsed, by D5b, starts **First Response** at that message (target 30 min). Both report met with identical elapsed time. Only the target differs (30 vs 40 min for normal priority), so a slow response between the two targets could read differently. Ticket 27 is the reverse: Zendesk applied First Response at the first customer message (target 30 min, exact match); Elapsed also opened a Next Reply cycle there that Zendesk did not.

## Re-run after the H-11 fix

**Fix.** `resolveCreationActor` in [`normalize.ts`](../packages/zendesk/src/normalize.ts) now decides `case_created.actor` from, in order: the ticket's `submitter_id` (Zendesk's own record of who created it, identical on every ingest), else the author of the creation audit, else the requester. It never reads a later audit. `submitter_id` outranks the audit author because Zendesk itself keys the first-reply SLA on it: it applied none to the agent-submitted tickets 54–59 and did apply one to ticket 1, whose creation audit is authored by an admin (a sample-data artifact) though the customer submitted it. `ZendeskTicket` gained `submitter_id`.

**Repair of rows written before the fix.** The commitment pipeline only creates missing commitments, so wrong ones would have stayed. [`repair-first-response-start.ts`](../packages/commitments/src/scripts/repair-first-response-start.ts) (dry run by default, `--apply` to delete, idempotent, `pnpm --filter @sla/commitments repair:first-response-start`) removes a first-response commitment whose stored start disagrees with the D5b rule; the next pipeline run recreates it correctly or, when nothing can start the clock, does not create it. **Run it on production after deploying the fix**, then let the worker cycle recreate. Deleting a commitment cascades its evaluations and notification records, so review the dry-run list first (any false-breach alerts already sent to customers' Slack/email stay sent).

**Dev dataset replay** (same Zendesk data, Elapsed re-normalized in full, repair applied to the dev database only, backup taken first, notification pipeline not run):

| | Before | After |
|---|---|---|
| `case_created.actor`, 45 tickets | 45 agent (ticket 1 wrongly) | 44 agent, 1 customer (ticket 1) |
| Tickets 54, 56, 57, 58, 59 first-response commitment | **breached** (false; Zendesk applied none) | **none** (matches Zendesk) |
| Ticket 1 first-response commitment | **missing** (Zendesk applied one) | **present**, start 10:41:21 = Zendesk's `apply_sla` time, 1372 s elapsed = Zendesk's 1372 s to fulfil |
| First-response commitments in dev | 13 (5 false) | 9 |
| Resolution table (45 tickets) | – | byte-identical (32/32 target/due/outcome) |
| Next Reply matches | 9/9 | 9/9 |
| Second replay / repair run | – | 0 changes |

Two things remain visible on ticket 1, neither caused by H-11: its target reads 1800 s in Elapsed and 3600 s in Zendesk (the sandbox policy was edited after the ticket, F3); and Elapsed reports the first response **breached** where Zendesk counts it fulfilled at the solve, because D5 decided that a reply-less close is never "met".

## Per-ticket comparison — Resolution

Zendesk vs Elapsed for the same ticket. "ZD elapsed" is start → Zendesk's `fulfill` event in calendar seconds.

| # | Prio | ZD policy | ZD target | EL target | ZD due | EL due | ZD outcome | EL outcome | ZD elapsed (start→fulfil) | EL elapsed | Δ | Result | Explanation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | normal | *none applied* | – | 3600s | – | 09-19 11:41:21 | no SLA | met | – | 1372s | – | ❌ MISMATCH | Zendesk applied no resolution SLA to this ticket (pre-dates/outside the imported policy version); Elapsed applied the current policy retroactively |
| 17 | normal | Set first reply time | 3600s | 3600s | 09-21 11:57:42 | 09-21 11:57:42 | met | met | 380s | 364s | -16s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (16s); Zendesk does not |
| 18 | urgent | Set first reply time | 1200s | 1200s | 09-21 11:35:08 | 09-21 11:35:08 | met | met | 299s | 299s | +0s | ✅ MATCH |  |
| 19 | urgent | Set first reply time | 1200s | 1200s | 09-21 11:37:45 | 09-21 11:37:45 | breached | breached | 2342s | 2298s | -44s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (44s); Zendesk does not; breach time EL 11:38:29 vs ZD 11:37:45 (Δ44s) |
| 20 | normal | Set first reply time | 3600s | 3600s | 09-21 15:59:14 | 09-21 15:59:14 | met | met | 466s | 458s | -8s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (8s); Zendesk does not |
| 21 | normal | Set first reply time | 3600s | 3600s | 09-21 17:52:30 | 09-21 17:52:30 | met | met | 1556s | 1548s | -8s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (8s); Zendesk does not |
| 22 | normal | Set first reply time | 3600s | 3600s | 09-21 19:21:26 | 09-21 19:21:26 | breached | breached | 48358s | 48358s | +0s | ✅ MATCH |  |
| 23 | normal | Set first reply time | 3600s | 3600s | 09-21 19:38:43 | 09-21 19:38:43 | breached | breached | 47306s | 47306s | +0s | ✅ MATCH |  |
| 24 | normal | Set first reply time | 3600s | 3600s | 09-21 20:15:56 | 09-21 20:15:56 | breached | breached | 45056s | 45056s | +0s | ✅ MATCH |  |
| 25 | high | Set first reply time | 2400s | 2400s | 09-21 21:07:38 | 09-21 21:07:38 | met | met | 756s | 756s | +0s | ✅ MATCH |  |
| 26 | high | Set first reply time | 2400s | 2400s | 09-21 21:20:28 | 09-21 21:20:28 | met | met | 970s | 970s | +0s | ✅ MATCH |  |
| 27 | normal | Set first reply time | 3600s | 3600s | 09-21 21:59:09 | 09-21 21:59:09 | met | met | 545s | 545s | +0s | ✅ MATCH |  |
| 28 | urgent | Set first reply time | 1200s | 1200s | 09-21 22:13:15 | 09-21 22:13:15 | breached | breached | 1300s | 1300s | +0s | ✅ MATCH |  |
| 29 | high | Set first reply time | 2400s | 2400s | 09-21 22:38:16 | 09-21 22:38:16 | breached | breached | 35294s | 35294s | +0s | ✅ MATCH |  |
| 30 | normal | Set first reply time | 3600s | 3600s | 09-21 22:59:48 | 09-21 22:59:48 | met | met | 876s | 876s | +0s | ✅ MATCH |  |
| 31 | urgent | Set first reply time | 1200s | 1200s | 09-22 08:10:06 | 09-22 08:10:06 | met | met | 51s | 51s | +0s | ✅ MATCH |  |
| 32 | urgent | Set first reply time | 1200s | 1200s | 09-22 08:11:22 | 09-22 08:11:22 | breached | breached | 7426s | 7426s | +0s | ✅ MATCH |  |
| 33 | normal | *none applied* | – | 3600s | – | 09-22 09:50:16 | no SLA | met | – | 512s | – | ❌ MISMATCH | Zendesk applied no resolution SLA to this ticket (pre-dates/outside the imported policy version); Elapsed applied the current policy retroactively |
| 34 | normal | Set first reply time | 3600s | 3600s | 09-22 09:58:59 | 09-22 09:58:59 | met | met | 26s | 26s | +0s | ✅ MATCH |  |
| 35 | normal | Phase 4 Native Test | 1800s | 3600s | 09-22 09:29:37 | 09-22 09:59:37 | met | met | 58s | 58s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (1800s); Elapsed only holds the current policy (60m/…) |
| 36 | normal | Phase 4 Native Test | 14400s | 3600s | 09-22 13:01:04 | 09-22 10:01:04 | met | met | 17s | 17s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (14400s); Elapsed only holds the current policy (60m/…) |
| 37 | normal | Phase 4 Native Test | 25200s | 3600s | 09-22 16:02:32 | 09-22 10:02:32 | met | met | 3185s | 3185s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (25200s); Elapsed only holds the current policy (60m/…) |
| 38 | normal | Phase 4 Native Test | 25200s | 3600s | 09-22 16:23:03 | 09-22 10:23:03 | met | met | 194s | 194s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (25200s); Elapsed only holds the current policy (60m/…) |
| 39 | normal | Phase 4 Native Test | 25200s | 3600s | 09-22 16:26:33 | 09-22 10:26:33 | met | met | 1102s | 1102s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (25200s); Elapsed only holds the current policy (60m/…) |
| 40 | normal | Phase 4 Native Test | 25200s | 3600s | 09-22 16:50:27 | 09-22 10:50:27 | met | met | 122s | 122s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (25200s); Elapsed only holds the current policy (60m/…) |
| 41 | normal | Phase 4 Native Test | 43200s | 3600s | 09-22 21:52:43 | 09-22 10:52:43 | met | met | 182s | 182s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (43200s); Elapsed only holds the current policy (60m/…) |
| 42 | normal | Phase 4 Native Test | 43200s | 3600s | 09-22 21:54:14 | 09-22 10:54:14 | met | met | 49s | 49s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (43200s); Elapsed only holds the current policy (60m/…) |
| 43 | normal | Phase 4 Native Test | 43200s | 3600s | 09-23 10:37:03 | 09-22 23:37:03 | met | met | 2539s | 2539s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (43200s); Elapsed only holds the current policy (60m/…) |
| 44 | normal | Phase 4 Native Test | 43200s | 3600s | 09-23 11:09:33 | 09-23 00:09:33 | met | met | 585s | 585s | +0s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (43200s); Elapsed only holds the current policy (60m/…) |
| 45 | normal | Phase 4 Native Test | 43200s | 3600s | 09-24 02:34:37 | 09-23 15:34:37 | met | breached | 13027s | 12811s | -216s | ⚠️ DATA | Zendesk applied deleted policy “Phase 4 Native Test” (43200s); Elapsed only holds the current policy (60m/…) |
| 46 | normal | Set first reply time | 3600s | 3600s | 09-23 19:12:17 | 09-23 19:12:17 | met | met | 472s | 349s | -123s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (123s); Zendesk does not |
| 47 | normal | Set first reply time | 3600s | 3600s | 09-24 20:21:57 | 09-24 20:21:57 | met | met | 1652s | 1580s | -72s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (72s); Zendesk does not |
| 48 | normal | Set first reply time | 3600s | 3600s | 09-26 14:11:29 | 09-26 14:11:29 | met | met | 3186s | 2362s | -824s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (824s); Zendesk does not |
| 49 | normal | Set first reply time | 3600s | 3600s | 09-26 18:10:57 | 09-26 18:10:57 | breached | breached | 39144s | 39139s | -5s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (5s); Zendesk does not |
| 50 | normal | Set first reply time | 3600s | 3600s | 09-27 13:09:09 | 09-27 13:09:09 | met | met | 1389s | 1389s | +0s | ✅ MATCH |  |
| 51 | normal | Set first reply time | 3600s | 3600s | 09-27 23:12:11 | 09-27 23:12:11 | met | met | 318s | 318s | +0s | ✅ MATCH |  |
| 52 | normal | Set first reply time | 3600s | 3600s | 09-27 23:14:31 | 09-27 23:14:31 | met | met | 415s | 415s | +0s | ✅ MATCH |  |
| 53 | normal | Set first reply time | 3600s | 3600s | 09-27 23:17:51 | 09-27 23:17:51 | met | met | 220s | 170s | -50s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (50s); Zendesk does not |
| 54 | urgent | Set first reply time | 1200s | 1200s | 09-28 11:15:08 | 09-28 11:15:08 | met | met | 1179s | 1179s | +0s | ✅ MATCH |  |
| 55 | urgent | Set first reply time | 1200s | 1200s | 09-28 12:09:52 | 09-28 12:09:52 | breached | breached | 1985s | 1985s | +0s | ✅ MATCH |  |
| 56 | urgent | Set first reply time | 1200s | 1200s | 09-28 12:43:15 | 09-28 12:43:15 | met | met | 647s | 647s | +0s | ✅ MATCH |  |
| 57 | high | Set first reply time | 2400s | 2400s | 09-28 13:14:36 | 09-28 13:14:36 | met | met | 633s | 633s | +0s | ✅ MATCH |  |
| 58 | high | Set first reply time | 2400s | 2400s | 09-28 13:27:17 | 09-28 13:27:17 | met | met | 122s | 122s | +0s | ✅ MATCH |  |
| 59 | urgent | Set first reply time | 1200s | 1200s | 09-28 15:01:12 | 09-28 15:01:12 | breached | breached | 9827s | 6643s | -3184s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (3184s); Zendesk does not |
| 60 | high | Set first reply time | 2400s | 2400s | 09-28 18:06:46 | 09-28 18:06:46 | met | met | 191s | 146s | -45s | ⚠️ SEMANTIC | Elapsed pauses Resolution on pending_customer (45s); Zendesk does not |

## Per-ticket comparison — First Response and Next Reply

Zendesk `reply_time` instance 1 = First Response, instances ≥ 2 = Next Reply.

| # | Kind | ZD (instance, target, start→fulfil) | EL (target, start, elapsed, status) | Result | Explanation |
|---|---|---|---|---|---|
| 1 | first_response | inst 1, 3600s, 09-19 10:41:21→11:04:13 | 1800s, 10:41:21, 1372s, breached | ⚠️ DATA | target ZD 3600s vs EL 1800s (Zendesk policy edited after ticket; Elapsed uses current version) |
| 21 | next_reply | inst 2, 2400s, 09-21 16:54:46→16:55:51 | 2400s, 16:54:46, 65s, met | ✅ MATCH |  |
| 21 | next_reply | inst 3, 2400s, 09-21 17:17:58→17:18:26 | 2400s, 17:17:58, 28s, met | ✅ MATCH |  |
| 21 | first_response | none | 1800s, 09-21 16:54:46, 65s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 26 | next_reply | inst 2, 1200s, 09-21 20:55:51→20:56:03 | 1200s, 20:55:51, 12s, met | ✅ MATCH |  |
| 26 | first_response | none | 1200s, 09-21 20:55:51, 12s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 27 | first_response | inst 1, 1800s, 09-21 21:02:43→21:05:06 | 1800s, 21:02:43, 143s, met | ✅ MATCH |  |
| 27 | next_reply | inst 2, 2400s, 09-21 21:06:37→21:08:14 | 2400s, 21:06:37, 97s, met | ✅ MATCH |  |
| 27 | next_reply | none | 2400s, 09-21 21:02:43, 143s, met | ❌ EXTRA in Elapsed | no Zendesk reply-time instance applied at this time |
| 32 | next_reply | inst 2, 600s, 09-22 07:52:16→07:52:37 | none | ❌ MISSING in Elapsed | Zendesk tracked this reply SLA; Elapsed created no next_reply commitment near 07:52:16 |
| 32 | first_response | none | 600s, 09-22 07:52:16, 21s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 45 | next_reply | inst 2, 3600s, 09-23 18:05:44→18:11:44 | none | ❌ MISSING in Elapsed | Zendesk tracked this reply SLA; Elapsed created no next_reply commitment near 18:05:44 |
| 45 | first_response | none | 1800s, 09-23 18:05:44, 360s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 46 | next_reply | inst 2, 2400s, 09-23 18:12:45→18:14:30 | none | ❌ MISSING in Elapsed | Zendesk tracked this reply SLA; Elapsed created no next_reply commitment near 18:12:45 |
| 46 | next_reply | inst 3, 2400s, 09-23 18:15:04→18:20:09 | 2400s, 18:15:04, 305s, met | ✅ MATCH |  |
| 46 | first_response | none | 1800s, 09-23 18:12:45, 105s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 47 | next_reply | inst 2, 2400s, 09-24 19:42:58→19:47:35 | none | ❌ MISSING in Elapsed | Zendesk tracked this reply SLA; Elapsed created no next_reply commitment near 19:42:58 |
| 47 | next_reply | inst 3, 2400s, 09-24 19:48:15→19:48:43 | 2400s, 19:48:15, 28s, met | ✅ MATCH |  |
| 47 | next_reply | inst 4, 2400s, 09-24 19:49:15→19:49:29 | 2400s, 19:49:15, 14s, met | ✅ MATCH |  |
| 47 | first_response | none | 1800s, 09-24 19:42:58, 277s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |
| 48 | next_reply | inst 2, 2400s, 09-26 13:45:34→13:45:37 | 2400s, 13:45:34, 3s, met | ✅ MATCH |  |
| 48 | next_reply | inst 3, 2400s, 09-26 13:59:24→14:04:35 | 2400s, 13:59:24, 311s, met | ✅ MATCH |  |
| 48 | first_response | none | 1800s, 09-26 13:45:34, 3s, met | ❌ EXTRA in Elapsed | Zendesk fulfilled reply instance 1 at ticket creation (agent-submitted ticket → no first-reply SLA); Elapsed opened a first_response clock |

## Limitations

Using the dev sandbox instead of live tenants means:

1. **Not the live-tenant check.** One tenant, not two; tickets are synthetic (created by one person, "test"-style content), not real customer traffic.
2. **No business hours, holidays or DST.** The only policy is 24/7 and the account has no schedules. Calendar-hours math is covered by unit and golden tests, not by this comparison.
3. **No open commitments.** Every commitment is finished, so at-risk and remaining-time behavior is untested here. Only finished elapsed/outcome is compared.
4. **No legs.** Zendesk has no engineering/support leg concept to compare, and `leg_spans` is empty in dev (14 Jira links, no leg spans).
5. **Small, uniform sample.** 45 tickets, mostly minutes-long; only 10 breaches; 11 tickets with Pending time; long pauses and multi-reopen histories are rare (no Zendesk `hold`).
6. **Policy history differs from Elapsed's** (F3), so 13 of 45 tickets cannot be compared on targets.
7. **Only Zendesk.** Intercom, Jira and the other providers have no equivalent ground truth here.
