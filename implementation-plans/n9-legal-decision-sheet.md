# N9 legal decision sheet (one page for the qualified reviewer)

> **NOT reviewed, NOT approved. Prepared by engineering, not legal advice.** Live `TermsView.tsx` and `PrivacyView.tsx` are unchanged. Facts and evidence for every row: `n9-legal-review.md` (F-1 to F-17, P-1 to P-9, L-01 to L-06, Q-1 to Q-7). Fill the Decision column and return; engineering then makes one copy change (plan 09 Appendix A).

Three separate things: **Part A** is for the owner (O-1 to O-3, engineering recommendations given). **Part B** needs a qualified legal reviewer; engineering may not decide it. L-01/L-02 and Q-5 depend on O-1 and O-2, so decide Part A first. D-07 is closed only when Part B is recorded in section 6 of `n9-legal-review.md` by the reviewer.

## A. Owner decisions (no lawyer needed; made first, they fix the facts the clauses state)

**Status (2026-10-10): O-1 = Option A, O-2 = Option B, O-3 = Option A: APPROVED by the owner (explicit written instruction in the Claude Code session of 2026-10-10). The qualified legal review in Part B is a separate required gate, is still PENDING, and is not satisfied by these decisions. O-2 is an infrastructure work item: no fixed egress IP exists or may be claimed until it is configured and verified (see "O-2 implementation record").**

### Owner decision record (all three DECIDED 2026-10-10; implementation and legal gates noted per item)

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
| Owner sign-off | **APPROVED: Option A.** Align the retention and privacy wording with the actual implemented behavior. Do not build a retention purge as part of this decision. Wording goes to the qualified reviewer (Part B, "Proposed wording"); the live Privacy copy is unchanged. Date: 2026-10-10. By: the owner, in the session instruction (written record in the Claude Code session transcript; a signed copy may be added here) |

**O-2 Outbound IP address (affects Q-5, F-15, the setup guide)**

| | |
| --- | --- |
| Situation | Elapsed's egress IP for customer API calls is not fixed or documented (F-15). A customer that allowlists IPs cannot be given an address |
| Option A (proposed) | Say in the setup guide and Beta terms that the address is **not fixed** for the pilot; choose pilot partners that do not require IP allowlisting |
| Option B | Provide a **fixed egress address** (infrastructure change: NAT or proxy with a static IP) before Beta |
| Implications of A | Documentation only; a partner needing allowlisting cannot join until B exists. The reviewer decides whether a disclosure is required (Q-5) |
| Implications of B | Infrastructure work and cost, a production change that needs its own deployment approval; then publish the address and commit to change notice |
| Decision needed | Choose **A** or **B** |
| Owner sign-off | **APPROVED: Option B.** Provide a fixed outbound egress IP. Infrastructure work item; nothing is claimed until configured and verified. Date: 2026-10-10. By: the owner, in the session instruction (written record in the Claude Code session transcript; a signed copy may be added here) |

**O-3 POST search endpoints in V1 (affects P-2, P-5, L-03)**

| | |
| --- | --- |
| Situation | The client sends GET or POST. A customer may designate a POST search endpoint. Live Terms/Privacy say the service is "read-only against every connected data source", which is not literally true for a POST request (L-03, F-2, F-3) |
| Option A (proposed) | **Keep POST** in V1 and have the reviewer approve wording that says Elapsed reads from connected sources, and for a custom API uses a customer-designated POST search endpoint only to read |
| Option B | **Restrict V1 to GET** (code change to the schema and validation, tests, and plan 09 amendment), so "read-only" stays literally true |
| Implications of A | No code change; relies on the customer's endpoint being read-only by design (cannot be enforced, L-06). Real helpdesk APIs often need POST search |
| Implications of B | Code and test change on `main`/`testing`; some customers' APIs cannot be connected; reverses a shipped capability |
| Decision needed | Choose **A** or **B** |
| Owner sign-off | **APPROVED: Option A.** Retain POST search endpoint support. Documentation must describe the supported behavior accurately and must not imply that POST itself guarantees read-only access. Date: 2026-10-10. By: the owner, in the session instruction (written record in the Claude Code session transcript; a signed copy may be added here) |

Interlock: the owner decisions are recorded, so the reviewer now receives them as fixed inputs: O-1 Option A (P-7 and L-01/L-02 are worded to the implemented behavior; no purge), O-2 Option B (Q-5: a fixed address is planned, NOT yet in place; nothing may be stated as fact until the verification below is recorded), O-3 Option A (P-2/P-5/L-03 describe POST support without implying it is read-only). Recording O-1 to O-3 does not satisfy Part B.

### O-2 implementation record (infrastructure work item; status: NOT STARTED, owner approved 2026-10-10)

**Claim rule.** Until the verification record below is filled in with real output, no document, setup guide or UI may say that Elapsed has a fixed outbound IP. Until then the truthful statement is that the address is not fixed (F-15).

**Why it matters in this codebase.** Customer API calls leave from two services: the **worker** (every scheduled sync and ingest, any number of replicas) and the **web** service (the setup flow: test, sample, preview, activation full-pass check). Both must use the same fixed address. Containers reach the internet through the host (Docker bridge NAT), so the address customers see is the host's public egress address. Everything else the host sends (Slack, SMTP, Sentry, OAuth token exchanges) uses it too.

**Requirements**
1. One stable public IPv4 address that all Custom REST outbound requests from web and worker originate from, in production.
2. It survives host stop/start, redeploy and container restarts (a plain auto-assigned public IP does not survive stop/start).
3. No other path: no request may leave over IPv6 or an alternate NAT/interface (a customer allowlist would miss it). Docker's default bridge has IPv6 off; confirm on the host.
4. The address is recorded in one place (this sheet and `docs/deployment.md`) and published in the Custom REST setup guide only after verification.
5. A change-notice commitment (how far ahead customers are told if the address changes) is a policy question for the reviewer/owner; engineering must not promise a notice period unprompted.

**Infrastructure investigation (2026-10-10; repository evidence only, no AWS access, nothing changed)**

| Question | Finding | Evidence | Confidence |
| --- | --- | --- | --- |
| How many hosts? | One production EC2 instance runs the whole stack (postgres, migrate, web, 3 worker replicas, nginx) | ROADMAP "single EC2 deployment"; `docker-compose.yml`; validation master A-10 | Verified (documents) |
| Instance type | t3.medium, 2 vCPU, 3.7 GiB | A-10 RESULT (read from the host's metadata service) | Verified |
| Public or private subnet? | **Almost certainly public** (not proven): nginx publishes 80/443 on the host, the host is reached directly over SSH at a public IPv4 address (`ubuntu@13.62.74.24`, the same address in the 2026-10-02 backup runbook and the 2026-10-10 checks), webhooks and customers reach it from the internet. A private-subnet host would need a load balancer in front, and none is documented | `docker-compose.yml` (nginx ports), `docs/production-backup-runbook.md`, master line 61 | Inferred; confirm in step D1 |
| Is 13.62.74.24 an Elastic IP or an auto-assigned public IP? | **Unknown.** The address was stable across at least 8 days, which is consistent with either (an auto-assigned address only changes on stop/start). Nothing in the repository says an Elastic IP was allocated | no document mentions an Elastic IP, NAT gateway, VPC or subnet (searched `docs/`, ROADMAP, README, scripts, compose files) | Gap |
| How does outbound traffic flow today? | Not documented. If the host is public-subnet with an internet-gateway route, outbound leaves from the instance's public IPv4 (the Elastic IP if one is associated, else the auto-assigned address). No proxy, NAT instance or egress proxy is configured anywhere in the repo (no `HTTP(S)_PROXY`, the custom client makes direct requests) | compose files, `packages/safe-http` | Inferred |
| IPv6? | Not documented; Docker's default bridge network has IPv6 disabled, so containers have no IPv6 route even if the VPC has IPv6 | Docker default | Confirm in D1 |
| Domain/DNS | The domain's A record is not in the repository; it presumably points at the same address | `NEXTAUTH_URL` is a domain; DNS not documented | Gap; matters for step C |

**Design decision (conditional on D1 confirming a public subnet): an Elastic IP associated with the instance.** A NAT Gateway is the wrong tool here: it exists to give instances in a *private* subnet a shared egress address and adds a standing monthly cost for traffic this host already sends directly. It would only be chosen if D1 shows the instance is in a private subnet (then: an Elastic IP attached to a NAT Gateway in a public subnet, with the private subnet's default route to it), or if production later grows past one host (then a NAT Gateway or an egress proxy with a static address becomes the right single egress point). If D1 shows the existing 13.62.74.24 is already an Elastic IP, **no AWS change is needed**: only the verification below, and this record is filled in.

**Cost (approximate; confirm on the AWS pricing page for the instance's region before approving)**
- Elastic IP / any public IPv4 address: about USD 0.005 per hour (about USD 3.65 per month), charged whether in use or idle since 2024. The instance already pays this for its auto-assigned public address, so replacing that address with an Elastic IP is roughly cost-neutral. An allocated but unassociated address is billed too, so release anything unused.
- NAT Gateway (only if D1 says private subnet): about USD 0.045 per hour (about USD 33 per month) plus about USD 0.045 per GB processed, plus its Elastic IP. Not recommended for the current single-host topology.
- No data-transfer change for the EIP option.

**Required AWS changes (NOT executed; Elastic IP path). Placeholders in angle brackets**
- D1 (read-only discovery, no change; needs your authorization only to be run by me over SSH, or you run it):
  ```bash
  # on the host (EC2 metadata, IMDSv2)
  T=$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  for k in instance-id placement/region public-ipv4 local-ipv4 network/interfaces/macs/; do echo "$k: $(curl -sS -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/$k)"; done
  MAC=$(curl -sS -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/network/interfaces/macs/ | head -1)
  curl -sS -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/network/interfaces/macs/${MAC}subnet-id; echo
  curl -sS -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/network/interfaces/macs/${MAC}ipv6s; echo   # empty/404 = no IPv6
  curl -4sS https://checkip.amazonaws.com; curl -6sS -m 4 https://checkip.amazonaws.com || echo "no IPv6 egress"
  docker network inspect $(docker network ls -q --filter name=default) --format '{{.Name}} ipv6={{.EnableIPv6}}'
  ```
  and with AWS CLI access (console or CLI, read-only): `aws ec2 describe-addresses --public-ips <public-ipv4>` (an association = already an Elastic IP), `aws ec2 describe-instances --instance-ids <id> --query 'Reservations[].Instances[].[SubnetId,PublicIpAddress,NetworkInterfaces[].Association]'`, `aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=<subnet-id>` (a `0.0.0.0/0` route to `igw-` means public subnet; to `nat-` means private).
- C1 allocate (only if D1 shows no Elastic IP): `aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=elapsed-prod-egress}]'` (record `AllocationId` and `PublicIp`).
- C2 associate to the instance's primary network interface: `aws ec2 associate-address --instance-id <id> --allocation-id <eipalloc-id>`. This **replaces** the current auto-assigned public address, which is then released by AWS and cannot be recovered.
- C3 update everything that used the old address: the domain's DNS A record (lower its TTL at least one TTL period beforehand), the `ssh`/`scp` examples in `docs/production-backup-runbook.md` and the validation master, any firewall or allowlist at a third party that names the old address, and any monitoring target.
- C4 verify (below), then record the address here. Nothing in the application or Compose files changes.

**Risks**
1. **The public address changes** if 13.62.74.24 is not already an Elastic IP: SSH access, DNS, third-party allowlists and webhook registrations that use the raw address break until updated. Webhook URLs that use the domain follow DNS. A short window of unreachability while DNS propagates is expected; plan it for low traffic.
2. Inbound security-group rules are unaffected, but confirm they do not restrict by the old address.
3. An allocated, unassociated Elastic IP keeps billing; an Elastic IP associated with a stopped instance is billed too. Release unused ones.
4. Single point of failure is unchanged (one host). A replacement host can take over the Elastic IP, which is an advantage over an auto-assigned address.
5. Customers that allowlist the address depend on it staying stable: do not release or move it without a notice policy (reviewer question, W-3).
6. Other outbound traffic from the host also uses the new address (SMTP, Slack, Sentry, OAuth providers); a provider that IP-restricts by the old address would break (none is known; check SMTP relay allowlists).

**Rollback plan**
- Before C2: record the current public address, `DisassociateAddress` state and DNS TTL.
- To undo the association: `aws ec2 disassociate-address --association-id <eipassoc-id>` then `aws ec2 release-address --allocation-id <eipalloc-id>`. The instance may then receive a new auto-assigned public address (depending on launch settings and the subnet), **not the old one**; so a rollback is not an exact restore if the old address was auto-assigned. Treat the change as one-way once DNS is updated: the safe rollback is to keep the Elastic IP and fix any broken reference, not to remove it. Keep SSH reachable by the new address throughout (do not close the session before testing a second one).
- Nothing in application configuration or data changes, so no application rollback or database action is involved.

**Implementation plan (proposed; owner action on AWS, then a deployment approval for any host/compose change)**
1. Run D1 (read-only discovery) and record the results in the verification section below.
2. If an Elastic IP already exists on the instance, skip to verification. If the instance is in a public subnet without one, do C1 to C4 in a planned window. If it is in a private subnet, stop and re-plan with a NAT Gateway Elastic IP (cost above) before any change.
3. No application change is needed for the address itself (the client makes direct requests with no proxy). If a stable address cannot be had, the alternative is an egress proxy with a static IP, which is a code and configuration change and needs a plan 09 amendment and approval.
4. Optional product work (separate, small, after verification): show the verified address in the Custom REST setup page and guide.
5. Everything above that touches AWS or production needs the owner's explicit authorization; none is given. Nothing was changed by this investigation.

**Verification criteria (all must be recorded before any claim)**
1. From inside the running **worker** container: `docker compose exec worker node -e 'fetch("https://checkip.amazonaws.com").then(r=>r.text()).then(console.log)'` prints the allocated address. Repeat from the **web** container.
2. Same result after restarting the containers. A host stop/start is the real persistence test but interrupts production: do it only in an approved window; otherwise record the AWS-side proof instead (`describe-addresses` showing the allocation associated with the instance, which survives stop/start by design).
3. An IPv6 check from both containers shows no IPv6 egress (or that Custom REST requests cannot use it).
4. A real end-to-end proof: a pilot-style test API (a customer test endpoint or a controlled server) logs the source address of a Custom REST test call from the web service and of a worker sync; both equal the address.
5. The address and the date are recorded here; then Q-5 can be answered as fact.

**Verification record:** address ______  allocation/NAT id ______  date ______  evidence ______  verified by ______  (EMPTY: not configured, not verified)

**Remaining blockers for O-2 (as of 2026-10-10):** (1) the discovery results D1 (public/private subnet, whether 13.62.74.24 is already an Elastic IP, IPv6) need AWS or host access that engineering does not have in this environment; (2) the owner's authorization for any AWS change (allocate/associate) and for the window, DNS update and third-party allowlist updates it implies; (3) verification from both containers after the change; (4) the reviewer's answer on what may be said and any change-notice commitment (W-3). The Beta may not advertise IP allowlisting support until these are done; pilot partners that require allowlisting wait for this item.

## B. Clauses that need the qualified reviewer's decision

| Clause | Needed to start the Beta pilot? | Engineering recommendation (a proposal, not a ruling) | Decision (Approve / Change / Reject) |
| --- | --- | --- | --- |
| P-1 Terms §2: name the custom REST source | Yes | Approve as drafted | |
| P-2 / L-03 "read-only" wording (**owner decided O-3 Option A: POST stays; wording must not imply POST is read-only**) | Yes | Replace "read-only against every connected data source" with "Elapsed reads from connected sources; for a custom REST API the customer may designate a search endpoint that uses POST, which Elapsed uses only to read" (F-2, F-3) | |
| P-3 Terms §3 credentials responsibility | Yes | Approve; recommend read-only credentials (Q-2) | |
| P-4 Privacy §1 what we collect | Yes | Approve: only mapped fields; message text only if a body field is mapped | |
| P-5 Privacy §2 what we don't collect | Yes | Approve with the P-2 qualification | |
| P-6 Privacy credentials security | Yes | Approve (F-6 verified in tests) | |
| P-9 Beta wording | Yes | Short Beta addendum: no uptime commitment, features may change, 1,000-live-ticket limit is a product limit not a promise (F-13, F-17) | |
| L-01 / L-02 retention and deletion on disconnect | Yes, for custom data (live copy already conflicts with behavior) | **Owner decided O-1 Option A (2026-10-10): wording follows the implemented behavior; no purge will be built.** Proposed wording below (W-1). Reviewer rules on the wording, on whether existing customers need notice, and on any deletion-on-request or account-closure statement (F-8, F-9, F-16) | |
| P-7 extend the disconnect sentence | No (blocked by L-02) | Hold until L-02 is decided | |
| L-05 name Sentry and Slack as subprocessors | No | Reviewer's call; independent of Custom REST | |
| P-8 marketing / plans copy "or a Custom REST source (Beta)" | No (held until a first organization is enabled) | Approve after the pilot starts | |
| Q-1 processor role, DPA before Beta | Yes (answer) | Reviewer to say whether a DPA is required for the pilot customers | |
| Q-5 outbound IP disclosure | Yes (answer) | **Owner decided O-2 Option B (2026-10-10): a fixed egress IP will be provided; it is NOT yet configured or verified.** Reviewer to say what may be stated meanwhile (recommended: "not fixed yet"), and whether a change-notice commitment is wanted once it exists (W-3) | |

### Proposed wording for the reviewer (drafts by engineering, not legal text; live copy unchanged)

**W-1 (O-1, Privacy §4 "Data retention", replaces the 90-day paragraph and the second paragraph on disconnect)**
> Elapsed keeps the data it reads from the systems you connect, and the events and SLA results derived from it, for as long as your organization's account exists, so that your SLA history can be reviewed and reproduced. We do not currently apply an automatic deletion schedule to this data. If you disconnect an integration, Elapsed stops reading from it and keeps the data already stored. [Reviewer: state what deletion, if any, is available on request or when an account is closed, any timing, and whether existing customers must be notified of this change.]

Facts it rests on: F-8, F-9, F-16 (no expiry, no purge job, raw events append-only). It deliberately promises no erasure on request.

**W-2 (O-3, Terms §2 and Privacy §2, replaces "read-only against every connected data source" for the custom source)**
> Elapsed is designed to read data from the systems you connect. For a custom REST API that you configure, you choose the endpoints Elapsed calls. These may include a search endpoint that uses the POST method to pass query parameters. Elapsed uses such an endpoint only to retrieve ticket data and sends only the request you configure; it cannot control what your endpoint does when it receives a request. You are responsible for making sure the endpoints and credentials you provide do not allow changes to your data. We recommend credentials limited to read access.

Facts: F-2, F-3, L-03, L-06 (POST is permitted; the use of POST does not make a request read-only; Elapsed cannot enforce what the customer's endpoint does). Customer guide (Appendix A) must not say "Elapsed never creates, edits or deletes anything in your ticket system" (L-06).

**W-3 (O-2, setup guide; use ONLY after the O-2 verification record is filled in)**
> Requests from Elapsed to your API come from the following fixed IP address: [address]. [Reviewer: any commitment about advance notice if the address changes.]

Until verified, the only permitted statement is: "Elapsed's outbound IP address is not fixed yet; do not rely on IP allowlisting."

## Handoff to the qualified reviewer (checklist; nothing here is approval)

1. Owner decisions O-1 (A), O-2 (B) and O-3 (A) are recorded above (2026-10-10); give the reviewer this sheet with them. O-2's address is not yet configured.
2. Send: this sheet, `n9-legal-review.md` (facts F-1 to F-17, proposals P-1 to P-9, issues L-01 to L-06, questions Q-1 to Q-7, decision record section 6), `apps/web/src/modules/marketing/legal/csr/TermsView.tsx` and `PrivacyView.tsx` (read-only; unchanged), `docs/data-retention-and-on-call.md`, plan 09 §7 and Appendix A.
3. The reviewer answers Part B (and Q-1 to Q-7) and records each clause in `n9-legal-review.md` section 6 (name, role, date, approved/changed/rejected, final wording).
4. Only then does engineering edit the live Terms and Privacy in one reviewed change and mark D-07. Until section 6 is filled by the reviewer, D-07 is BLOCKED (BL-09) and no copy changes.

## C. What stays blocked without the reviewer

Any live Terms or Privacy edit, the marketing copy (P-8), and the D-07 pass. Everything else for the pilot is engineering-complete (see validation master Checkpoint B).
