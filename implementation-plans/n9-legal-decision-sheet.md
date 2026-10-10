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

### O-2 implementation record (status 2026-10-10: the fixed address ALREADY EXISTS and egress through it is verified; no AWS change is needed; remaining items below)

**Claim rule (updated 2026-10-10).** The verification record below is now filled in with real output. What may be stated as verified fact: the production host's outbound IPv4 address is the Elastic IP 13.62.74.24, used by the web service and all three worker replicas. What may not yet be stated to customers: any promise about the address (stability period, change notice) until the reviewer rules on W-3, and any claim about IPv6 or about a second host. The security-group/NACL review (A5) is still open. Until then the truthful statement is that the address is not fixed (F-15).

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

**Step 1 discovery attempt (2026-10-10; read-only; owner approved Step 1 only): NOT PERFORMED, access unavailable.** No finding below is verified. This environment has no `ssh` client and no SSH key, no AWS CLI or SDK, and the only AWS-named credentials present are session-provided (their account, scope and region are not established as the production account), so I did not use them to query EC2. Nothing was run against the host or AWS; nothing changed.

**Step 1 host results (2026-10-10; owner ran Part H H0 to H4 on the production host and pasted the output; Part A not yet run).** Verified means shown by that output.

| # | Check | Status | Evidence (owner-run output) |
| --- | --- | --- | --- |
| 1 | Is 13.62.74.24 an Elastic IP? | **VERIFIED: YES** (2026-10-10, owner-run A1) | `describe-addresses`: AllocationId `eipalloc-0aca3c86efbc78f3c`, AssociationId `eipassoc-0659342d30c647c09`, Domain `vpc`, NetworkInterfaceId `eni-0052c2f16e16ddc0e` (the instance's primary interface), InstanceId `i-093d3f4c0c8a99951`, private IP 172.31.21.151. A2 confirms the same ENI carries 13.62.74.24 and no IPv6. A6: it is the only Elastic IP in eu-north-1 in this account |
| 2 | Instance, VPC, subnet, outbound path | **Partly verified.** Instance `i-093d3f4c0c8a99951` (t3.medium), `eu-north-1a`, private address 172.31.21.151, subnet `subnet-0eb9b091e0bd405f3`, VPC `vpc-091ddb9eba8355fb1`; default route `via 172.31.16.1 dev ens5`. The 172.31.0.0/16 addressing suggests a default VPC (inference). **Public path verified by behavior:** the host and every container egress as 13.62.74.24, the instance's own public address, which cannot happen behind a NAT gateway (it would show the gateway's address). **AWS side verified (2026-10-10, A3/A4/A6):** subnet `MapPublicIpOnLaunch=true`, no IPv6 on the subnet; the subnet has no explicit route-table association, so it uses the VPC main route table `rtb-095a12c0937403afd`: `172.31.0.0/16 local` and `0.0.0.0/0 -> igw-060344d5eba117a42` (internet gateway, active), no `::/0` route; **no NAT gateways** in the VPC. So: public subnet, direct internet-gateway egress, no NAT or alternative egress path. NACLs (A5) not yet read | H1, H2, H3 |
| 3 | IPv6 / alternative outbound path | **Verified: none.** IMDS `ipv6s` and `subnet-ipv6-cidr-blocks` return 404; no IPv6 default route and no global IPv6 address on the host; containers: `ENETUNREACH` to an IPv6 endpoint; Docker networks `ipv6=false`. (The host `curl -6 checkip.amazonaws.com` failed with a DNS error because that name has no AAAA record; that single test was inconclusive, the other evidence is not) | H1, H2, H3 |
| 4 | Do web and every worker replica use the same outbound IP | **Verified: yes.** web, and all 3 worker replicas, egress as 13.62.74.24 (IPv4); IPv6 unreachable for all | H3 |
| 5 | DNS and external allowlists | **Finding:** the app is served by **IP, not by a domain**. `NEXTAUTH_URL` host is `13.62.74.24`; `dig` returns only the literal; there is no DNS record or TTL involved. Third-party allowlists and registered webhook/OAuth URLs: **NOT VERIFIABLE from the server** | H4 |
| 6 | Security groups, NACLs, exposed ports | **VERIFIED (2026-10-10, owner-run A5).** Subnet NACL: default allow-all both directions. Security group `sg-0427ab1f35847c4f6`: **inbound** tcp 80, 443 and **22 from 0.0.0.0/0**, no IPv6 rules, nothing else (no database, web 3000 or worker 8081 port is open, consistent with Compose publishing only nginx 80/443); **outbound** all protocols to 0.0.0.0/0 (nothing restricts Custom REST egress). Host listeners match: 22, 80, 443 plus loopback/local DNS. **Exposure concern (not an O-2 blocker, no change made):** SSH (22) is open to the whole internet; see Remaining item (2). Port 80 and 443 to the world are expected for the app and webhooks |
| 7 | Part A (AWS CLI A1 to A4, A6) | **DONE (2026-10-10, run by the owner in AWS CloudShell; the production host has no `aws` CLI and none was installed).** A5 (security-group and NACL rules) and A7 (Route 53, not applicable: no domain) remain | CloudShell output |

**Result (2026-10-10): Step 2 is NOT NEEDED.** 13.62.74.24 is already an Elastic IP associated with the instance, so nothing has to be allocated or associated and the application URL does not change. The paragraph below describes the case that did not occur and is kept for the record.

**Consequence for Step 2 (not a recommendation to change anything yet; the conditional case did not occur).** Because the application's own public URL (`NEXTAUTH_URL`) is the raw IP 13.62.74.24, every OAuth redirect URI, webhook URL and customer link points at it. If A1 shows 13.62.74.24 is an auto-assigned address, it cannot be promoted to an Elastic IP: allocating one gives a different address, and moving the application to it would break those URLs until they are all re-registered (a domain would remove that coupling). If A1 shows it is already an Elastic IP, no AWS change is needed. A1 therefore decides everything and must run first.

Step 1 is two read-only procedures. Do not send SSH keys, AWS keys, session tokens or `.env` contents to anyone, including in chat; only the redacted outputs described below are needed. Nothing here allocates, associates, changes or restarts anything.

**Part H: on the production host**

| | |
| --- | --- |
| Where | On the EC2 host, in a shell you open yourself (`ssh` from your own machine with your own key), in `~/elapsed` |
| Access level | The `ubuntu` login that already runs `docker compose` there. No `sudo`, no AWS credentials. Reads the instance metadata service (IMDSv2), network state and the running containers only |
| Side effects | Four short outbound HTTPS requests to public IP-echo services and `docker exec` of a one-line Node command (no writes). Services are not restarted |

Save everything to a file as you go: start with `script -q d1-host.txt` (end with `exit`), or append `| tee -a d1-host.txt` yourself.

```bash
cd ~/elapsed

# H1  identity, subnet, public address, IPv6 (instance metadata, IMDSv2)
T=$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
M=http://169.254.169.254/latest/meta-data
for k in instance-id instance-type placement/region placement/availability-zone public-ipv4 local-ipv4; do echo "$k: $(curl -sS -H "X-aws-ec2-metadata-token: $T" $M/$k)"; done
MAC=$(curl -sS -H "X-aws-ec2-metadata-token: $T" $M/network/interfaces/macs/ | head -1)
for k in subnet-id vpc-id public-ipv4s ipv6s subnet-ipv6-cidr-blocks; do echo "$k: $(curl -sS -H "X-aws-ec2-metadata-token: $T" $M/network/interfaces/macs/${MAC}$k)"; done

# H2  the host's own routes and outbound address (IPv4, then IPv6)
ip -4 route show default
ip -6 route show default
ip -6 addr show scope global
curl -4sS -m 6 https://checkip.amazonaws.com
curl -6sS -m 6 https://checkip.amazonaws.com || echo "no IPv6 egress from the host"

# H3  web and worker containers: outbound IPv4 and IPv6 (read-only; one request each)
C="docker compose -f docker-compose.yml --env-file .env"     # the 2026-10-10 checks found only .env on this host; use the env file you actually deploy with
CHK='Promise.allSettled([fetch("https://checkip.amazonaws.com"),fetch("https://api6.ipify.org")]).then(async r=>{for(const x of r)console.log(x.status==="fulfilled"?(await x.value.text()).trim():"failed: "+(x.reason&&x.reason.cause&&x.reason.cause.code))})'
echo "== web";    $C exec -T web    node -e "$CHK"
echo "== worker"; $C exec -T worker node -e "$CHK"
# every worker replica (there may be several):
for id in $(docker ps -q --filter name=worker); do echo "== replica $id"; docker exec "$id" node -e "$CHK"; done
# Docker networks: is IPv6 enabled on any of them?
docker network ls -q | xargs docker network inspect --format '{{.Name}} ipv6={{.EnableIPv6}}'

# H4  DNS: replace <your-production-domain> with the domain customers use; I do not know it and it is not in the repository
D=<your-production-domain>
getent hosts "$D"; (command -v dig >/dev/null && { dig +noall +answer A "$D"; dig +noall +answer AAAA "$D"; }) || echo "dig not installed; use nslookup -type=A $D and -type=AAAA"
grep -E '^NEXTAUTH_URL=' .env | cut -d= -f2-      # prints only the app URL; never print the rest of .env
```

If the shell has no `dig`/`nslookup`, `getent hosts` is enough for the A/AAAA addresses; the record TTL can be read from the DNS provider's console instead.

**Part A: AWS CLI (control plane)**

| | |
| --- | --- |
| Where | Your own workstation or AWS CloudShell, signed in to the production account in the region reported by H1 (`placement/region`). Not on the host unless the host already has a read-only instance role |
| Access level | Read-only EC2 `Describe*` permissions (the AWS-managed `ReadOnlyAccess` or `AmazonEC2ReadOnlyAccess` policy is enough): `DescribeAddresses`, `DescribeInstances`, `DescribeNetworkInterfaces`, `DescribeSubnets`, `DescribeRouteTables`, `DescribeInternetGateways`, `DescribeNatGateways`, `DescribeSecurityGroups`. Optional for DNS only: Route 53 `ListHostedZones` and `ListResourceRecordSets`. No write permission is needed or should be used |
| Side effects | None; every command below is a `describe-` / `list-` call |

```bash
export AWS_PAGER=""
R=<region from H1>

# A1  is the host's public address an Elastic IP? (an Association entry = yes; "InvalidAddress.NotFound" = it is not an Elastic IP in this account/region)
aws ec2 describe-addresses --region "$R" --public-ips 13.62.74.24

# A2  the instance: subnet, VPC, public and IPv6 addresses, interfaces, security groups
aws ec2 describe-instances --region "$R" --filters Name=ip-address,Values=13.62.74.24 \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,SubnetId,VpcId,PublicIpAddress,Ipv6Address,NetworkInterfaces[].[NetworkInterfaceId,Association.PublicIp,Association.IpOwnerId,Ipv6Addresses],SecurityGroups[].GroupId]'
# If A2 returns nothing, the address is not on a running instance's primary interface in this region: stop and report that.

# A3  subnet attributes and IPv6 (use the SubnetId from A2)
aws ec2 describe-subnets --region "$R" --subnet-ids <subnet-id> \
  --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch,AssignIpv6AddressOnCreation,Ipv6CidrBlockAssociationSet[].Ipv6CidrBlock]'

# A4  how outbound traffic is routed: the route table of that subnet
#     0.0.0.0/0 -> igw-...  = public subnet;  0.0.0.0/0 -> nat-... = private subnet;  ::/0 -> igw-/eigw- = an IPv6 outbound path
aws ec2 describe-route-tables --region "$R" --filters Name=association.subnet-id,Values=<subnet-id> \
  --query 'RouteTables[].[RouteTableId,Associations[].[Main,SubnetId],Routes[].[DestinationCidrBlock,DestinationIpv6CidrBlock,GatewayId,NatGatewayId,State]]'
# If A4 returns nothing the subnet uses the VPC's main route table: repeat with Name=association.main,Values=true and Name=vpc-id,Values=<vpc-id>.

# A5  security groups of the instance (use the GroupIds from A2): inbound and outbound rules, read-only
aws ec2 describe-security-groups --region "$R" --group-ids <sg-id> [<sg-id> ...] \
  --query 'SecurityGroups[].[GroupId,GroupName,IpPermissions[].[IpProtocol,FromPort,ToPort,IpRanges[].CidrIp,Ipv6Ranges[].CidrIpv6],IpPermissionsEgress[].[IpProtocol,FromPort,ToPort,IpRanges[].CidrIp,Ipv6Ranges[].CidrIpv6]]'
# Also read-only: network ACLs of the subnet (a rule could block or restrict outbound)
aws ec2 describe-network-acls --region "$R" --filters Name=association.subnet-id,Values=<subnet-id> \
  --query 'NetworkAcls[].Entries[].[RuleNumber,Egress,Protocol,RuleAction,CidrBlock,Ipv6CidrBlock]'

# A6  optional: other Elastic IPs and NAT gateways in the VPC (to see whether any already exist and are unused)
aws ec2 describe-addresses --region "$R" --query 'Addresses[].[PublicIp,AllocationId,AssociationId,InstanceId,NetworkInterfaceId]'
aws ec2 describe-nat-gateways --region "$R" --filter Name=vpc-id,Values=<vpc-id> --query 'NatGateways[].[NatGatewayId,State,SubnetId,NatGatewayAddresses[].PublicIp]'

# A7  optional DNS (only if the domain is in Route 53 in this account): where its A/AAAA records point and their TTL
aws route53 list-hosted-zones --query 'HostedZones[].[Id,Name]'
aws route53 list-resource-record-sets --hosted-zone-id <zone-id> --query "ResourceRecordSets[?Type=='A'||Type=='AAAA'].[Name,Type,TTL,ResourceRecords[].Value,AliasTarget.DNSName]"
```

**Redacting before you share (keep what establishes the topology)**

Run the saved files through this, then read them once yourself before sending:

```bash
sed -E \
  -e 's/\b[0-9]{12}\b/<ACCOUNT_ID>/g' \
  -e 's/(arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:)[0-9]{12}/\1<ACCOUNT_ID>/g' \
  -e 's/((AWS_)?(SECRET|ACCESS)[A-Z_]*[=:] *)[^ ]+/\1<REDACTED>/Ig' \
  -e 's/((token|password|passwd|key)[A-Za-z_]*[=:] *)[^ ]+/\1<REDACTED>/Ig' \
  d1-host.txt > d1-host.redacted.txt
```
(Same for the AWS output file.)

| Redact | Why |
| --- | --- |
| 12-digit AWS account IDs (including `IpOwnerId`, ARNs, `OwnerId`) | account identifier |
| Any key, token, secret, password; the contents of `.env`; key-pair names if shown | secrets |
| Customer or office CIDRs in security-group rules: replace with `<office-ip>`/`<customer-ip>` but keep the port, protocol and whether it is `0.0.0.0/0` | the exposure shape matters, the individual addresses do not |
| Tags/names that identify other customers | privacy |

| Do NOT redact (needed to establish the topology) | Used to decide |
| --- | --- |
| The host's public IPv4 (`13.62.74.24`) and any other public addresses printed, both host and containers | Elastic IP vs auto-assigned, web vs worker egress |
| Region, availability zone, instance type, instance-id, subnet-id, vpc-id, route-table-id, security-group-ids, allocation/association ids (shorten if you wish, but keep them distinguishable) | joins A1 to A5 |
| Route destinations and targets, including the prefixes `igw-`, `nat-`, `eigw-` and their state | public vs private subnet, IPv6 path |
| Whether an `Association` is present in A1/A2, `MapPublicIpOnLaunch`, the IPv6 fields (empty or not) | Elastic IP; IPv6 enabled |
| Security-group ports/protocols and whether a source is `0.0.0.0/0` or `::/0`; egress rules | inbound exposure and outbound restrictions |
| The DNS record type, value (address or alias target) and TTL; the app domain | impact of an address change |
| Error codes such as `InvalidAddress.NotFound`, `UnauthorizedOperation` | tell me which check could not run |

If a command fails with `UnauthorizedOperation`, paste the error and skip it; do not widen your permissions beyond read-only for this.

**What to send back:** `d1-host.redacted.txt` (Part H) and the redacted Part A output, plus which of H1 to H4 and A1 to A7 you could not run. Third-party allowlists (webhook URLs registered at Zendesk/Jira/Linear/Intercom, the ops SMTP relay, Sentry, partner firewalls) cannot be read from here: list from your own records which of them name `13.62.74.24` rather than the domain. Then I will fill the findings table above and recommend the minimum action. Step 2 stays unstarted until you approve it explicitly.

How to read the results: an association in `describe-addresses` means no AWS change is needed (verify only). Default route (A4) to `igw-` with a public address on the primary interface means public subnet, and an Elastic IP is the design. Default route to `nat-` or no public address means private subnet: stop and re-plan with a NAT Gateway Elastic IP. A global IPv6 address plus a working `curl -6` from a container means a second outbound path exists and must be closed or accounted for before any address is published. Different addresses in H3 for web and worker would mean more than one egress path.

**Minimum required action (recommendation):** you run Part H (on the host) and Part A (AWS CLI, read-only) above and send the redacted outputs; no keys or credentials are shared with anyone. Only then choose between "verify only", "allocate and associate an Elastic IP" (Step 2, needs your separate approval) or "re-plan with a NAT Gateway".

**Required AWS changes (NOT executed; Elastic IP path). Placeholders in angle brackets**
- D1 (read-only discovery, no change): the Part H / Part A procedure above (H1 to H4, A1 to A7).
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

**SSH exposure: separate finding, tracked apart from O-2 (recorded 2026-10-10; it does NOT gate or complete the fixed-egress work).**

| Item | Status | Basis |
| --- | --- | --- |
| Effective sshd configuration: `PasswordAuthentication no` | **Verified** | owner-run effective-configuration check on the host |
| `PubkeyAuthentication yes` | **Verified** | same |
| `PermitRootLogin prohibit-password` | **Verified** | same. This is NOT "root login disabled": root can still log in over SSH with a public key if a key is present in root's `authorized_keys`. Do not describe root login as disabled |
| Security group `sg-0427ab1f35847c4f6` allows inbound TCP 22 from `0.0.0.0/0` | **Verified** | owner-run A5, above |
| Whether any key is in root's `authorized_keys`; which keys are in `ubuntu`'s | **Not verified** | not checked |
| Whether brute-force or key-scanning attempts occur; fail2ban or similar present | **Not verified** | not checked |
| Whether the agent key (`~/.ssh/elapsed-agent`, added to the production `ubuntu` user on 2026-10-01) is still present in `authorized_keys` and still required | **Not verified / unknown.** The key was not available in this environment, so engineering has not used it | owner statement of 2026-10-01 only |

Interpretation: password guessing over SSH is not possible and key-based login is the only method, which is a good baseline. The remaining exposure is that the SSH port accepts connections from the whole internet (key-based attacks, scanning noise, any future sshd vulnerability) and that root key login is still allowed by policy. This is a hardening decision for the owner, independent of O-2.

**Recommended SSH restriction plan (NOT applied; nothing changed). Principle: never remove a working access path until a replacement has been tested from a second session.**
1. Inventory first (read-only, on the host): list the public keys in `~ubuntu/.ssh/authorized_keys` (fingerprints only: `ssh-keygen -lf ~/.ssh/authorized_keys`) and check whether `/root/.ssh/authorized_keys` exists and has keys (needs root to read; if you cannot read it without `sudo`, check in a window you approve). Decide which keys must stay: yours; the agent key only if the owner still wants it (otherwise remove its line in a later approved change). Record the decision; do not print private keys.
2. Add a second, independent access path first: AWS Systems Manager Session Manager (needs the SSM agent, an instance profile with `AmazonSSMManagedInstanceCore`, and either outbound HTTPS, which exists, or VPC endpoints) or EC2 Instance Connect. Test a login through it while the current SSH path stays open.
3. Narrow the security group in two steps: (a) add a rule for TCP 22 from your fixed administrative address(es) `/32` (and the agent's, only if still required and it has a stable address; this environment's address is not stable, so it likely cannot be allowlisted); (b) keep the `0.0.0.0/0` rule until a new SSH session from the allowed address works in a second terminal; then remove only the `0.0.0.0/0` rule. Rollback: re-add the rule from CloudShell (console or CLI), which does not depend on SSH access.
4. Harden sshd afterwards, separately: set `PermitRootLogin no` (after confirming no process needs root key login), keep `PasswordAuthentication no`; validate with `sshd -t` and reload (not restart) from an open session, then test a new login before closing the old one.
5. Optional: fail2ban or equivalent, and CloudWatch alerts on failed SSH logins.
6. Each of these changes the production host or AWS, so each needs your explicit approval and a window; the plan is a proposal only.

**Third-party dependency inventory on 13.62.74.24 (2026-10-10; repository and documentation evidence ONLY; nothing was contacted, no secrets or env files read).** "Depends" means the repository shows the mechanism; whether the third party actually holds the value is not visible from here and is marked.

*Inbound: the address is the application's public URL (`NEXTAUTH_URL` is the raw IP). Nothing breaks while the Elastic IP stays; these matter if it is ever released or replaced.*

| # | System | Dependency on the address | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | OAuth apps at Zendesk, Jira (Atlassian), Slack, Linear, GitHub (and Intercom) | Redirect URI `https://<NEXTAUTH_URL>/api/integrations/<provider>/callback` must match what is registered with each provider | `apps/web/src/lib/{zendesk,jira,slack,linear,github}-env.ts` (`redirectUri: ${appUrl}/api/integrations/<p>/callback`), `intercom-redirect.ts`; `docs/deployment.md` (`NEXTAUTH_URL` "must match what's registered with each provider") | Mechanism **verified in code**. What is actually registered in each provider console / per-organization OAuth client: **not verified** (owner input) |
| 2 | Zendesk and Jira webhooks configured in customers' accounts | Target URL contains the app address: `/api/webhooks/zendesk/<integrationId>` and `/api/webhooks/jira/<integrationId>` | `apps/web/src/app/api/webhooks/{zendesk,jira}/[integrationId]/route.ts`; `webhook-pipeline.ts` | Mechanism verified; the registered URLs at customers: **not verified** |
| 3 | Links in emails, Slack/alert messages and monthly reports already sent | Built from the app URL | `packages/email/src/app-url.ts`, `packages/notifications/src/format.ts`, `monthly-report.ts` | Verified in code; sent history not inspected |
| 4 | TLS trust for the bare-IP origin | A certificate for an IP, if any | The 2026-10-10 host check used `curl -k` against `https://13.62.74.24` (validation master, A-checks), which suggests the certificate is not trusted by default | **Unknown** (single data point; cause not established). Matters for OAuth callbacks and webhook senders that verify TLS |
| 5 | Search engines | None: indexing is switched off for a bare IP | `docs/deployment.md` (Search engine indexing) | Verified in documentation |
| 6 | Dev tunnel (ngrok) | None for production | `docker-compose.tunnel.yml` is dev/staging only | Verified |

*Outbound: the address is the source IP of Elapsed's own requests. These are the systems that could allowlist it (the reason for O-2).*

| # | System | Dependency on the address | Evidence | Status |
| --- | --- | --- | --- | --- |
| 7 | Customers' ticket/tracker systems (Zendesk IP restrictions, Atlassian IP allowlists, GitHub organization IP allow lists, Intercom, Linear) and customers' custom REST APIs behind a firewall | A customer that restricts by source IP would have to list 13.62.74.24 | Nothing in the repository or `docs/customer-guide.md` mentions IP allowlisting or tells a customer an address (F-15 until 2026-10-10 said none was documented) | **Unknown**: which customers (of the 10 live) allowlist an IP, if any. Owner's support and onboarding records |
| 8 | Ops alerts: Slack incoming webhook and the ops SMTP relay (`OPS_ALERT_*`) | The SMTP relay may restrict by sender IP; Slack incoming webhooks normally do not | `apps/worker/src/ops-alert.ts`, `docs/deployment.md`; replacement of the leaked SMTP password is BL-08 | Relay restriction **unknown** (owner/provider account) |
| 9 | Each organization's own SMTP server (Settings, Notifications) | May restrict by sender IP | `SMTP_ALLOW_PRIVATE_HOSTS` and org SMTP settings in `docs/deployment.md` | **Unknown** per organization |
| 10 | Sentry | Not normally IP-restricted | `SENTRY_DSN` in `docs/deployment.md` | Assumption, not verified |
| 11 | Off-site backup target (`OFFSITE_COPY_CMD`, for example an S3 bucket policy) | A bucket policy could restrict by source IP | `docs/deployment.md` (Backups) | **Unknown**: whether it is configured and how |
| 12 | Billing provider | None: OD-03 (provider) is undecided | validation master OD-03 | n/a |
| 13 | Partner or customer firewalls that allow inbound admin access (SSH) from 13.62.74.24 | Possible, not documented | none | **Unknown** |

Needs owner input: the list of customers (if any) who told Elapsed their IP restrictions; the redirect URIs and webhook URLs actually registered at each provider; the ops SMTP relay and off-site backup policies; whether the TLS certificate on `https://13.62.74.24` is trusted (browser or `curl` without `-k`).

**Controlled Custom REST egress test: PROPOSED, NOT RUN (2026-10-10; waiting for owner approval and a controlled endpoint).** Nothing was sent anywhere.

*What the implementation constrains (read from `packages/safe-http` and `packages/custom-ticket`):* the base URL must be `https` on port 443 (no custom port), the host must be a public DNS name (IP literals, single-label and `.local/.internal` names are refused) and must resolve to public addresses, and the TLS certificate must verify against the normal CA store (the test seams that accept private hosts or a custom CA are disabled in production). So the endpoint must be a **real public hostname with a valid certificate on port 443 that the owner controls and whose access log shows the TCP peer address**. It must not sit behind a CDN, proxy or load balancer that replaces the client address (a forwarded-for header is not proof).

*Endpoint (owner provides or confirms):* for example a small server of the owner's with nginx on 443 logging `$remote_addr`, `$time_iso8601`, the request line and `$ssl_server_name` (and NOT request headers or bodies), forwarding to `node packages/custom-ticket/dev/mock-helpdesk.mjs` (deterministic synthetic tickets, fake key `mock-key-123`; listens on 127.0.0.1:4010). Hostname, how the owner reads the log, and its address family (IPv4 only, so a stray IPv6 path would show) are needed before anything runs.

*Safe payload and data:* synthetic mock tickets only; the only credential is the mock's fake key; no real customer data and no Elapsed secret is sent. nginx does not log headers, and Elapsed redacts secret values in its own logs and sync history (N9.3 scrubber). A random nonce is placed in the request path or a static query parameter so each probe is unambiguous.

*Phase 0: plain container egress to the controlled endpoint (available now once approved; no Custom REST code involved).* One `GET https://<host>/__egress/<nonce>-web` from the web container, and one `/__egress/<nonce>-worker-N` from each worker replica, using the same one-line `docker exec ... node -e fetch(...)` pattern as H3 (read-only; no restarts; no env read). Expected: five log lines, each with peer address 13.62.74.24 and no other address. This proves the path from each container to a server the owner controls, but it is not the Custom REST client.

*Phase 1: the real Custom REST path (needs the release that contains N9 to be deployed and the Custom REST rollout in place; that deployment is a separate approval and has not been given; whether production currently runs it is not known to engineering).* Use a dedicated test organization (named e.g. `egress-test`, no real users) added to the Beta allowlist by an operator (the rollout block stays untouched), signed in as its owner:
1. **Web egress:** in the setup flow enter the draft (base URL `https://<host>`, API-key header auth with the mock key, the mock-helpdesk mapping) and run Test, Sample and Preview before activating. At that point only the web service can issue requests (the worker ignores a non-activated source). Record the time window. Expected: log lines for `/v2/tickets...` with peer 13.62.74.24.
2. **Worker egress:** activate; the next worker poll (5 minutes by default, or the owner's manual sync) ingests the synthetic tickets. Record the window. Expected: log lines with peer 13.62.74.24 during that window and the sync-run showing `requests > 0` and outcome `ok`.
3. **Attribution:** web and worker are told apart by the order and time windows above (web before activation, worker after), plus the probe nonce in the draft's static query value.
4. **Pass:** every request in both windows has peer 13.62.74.24 (IPv4), none from another address; zero requests from an IPv6 address; sync-run history shows the worker's request count matching the log.

*Cleanup (also needs approval):* disconnect the test integration in the app (soft: data kept), remove `egress-test` from the allowlist (this also pauses polling), stop or firewall the endpoint, delete any temporary DNS record. Raw events and cases created for the synthetic tickets are append-only and remain in the test organization (documented; synthetic only). Nothing in other organizations is touched.

*Failure handling:* a peer address other than 13.62.74.24: stop, record the exact address and which phase, change nothing, and investigate (a proxy in front of the endpoint is the most likely cause, so first prove the endpoint log shows the real peer); a TLS or hostname error (`tls_error`, `blocked_destination`): fix the endpoint (valid certificate, port 443, public name), not Elastic's settings; HTTP 401: wrong mock key; timeouts or `unreachable`: endpoint or firewall; any request that appears from an unexpected source or any real data in the log: stop and treat as an incident; if either phase cannot be completed, O-2 stays open and the failure is recorded in this record.

*Approvals needed from the owner before anything runs:* (a) the controlled hostname and its log access, (b) approval to run Phase 0, (c) separately, the production release deployment and approval for the test organization and Phase 1, (d) approval for the cleanup steps.

**Verification record (2026-10-10):** address **13.62.74.24** (Elastic IP, allocation `eipalloc-0aca3c86efbc78f3c`, association `eipassoc-0659342d30c647c09`, region eu-north-1); evidence: A1/A2/A4/A6 (AWS CloudShell, read-only) and H2/H3 (owner-run on the host): host IPv4 egress 13.62.74.24; web container 13.62.74.24; worker replicas 1 to 3 each 13.62.74.24 (checked against an external IP-echo service); IPv6: none (no IPv6 on the interface or subnet, no default IPv6 route, containers `ENETUNREACH`, Docker networks `ipv6=false`); verified by the owner running the commands, recorded by engineering. **Not done and not claimed:** (a) a host stop/start test, which would interrupt production; the AWS-side proof stands in for it, since an Elastic IP stays associated across stop/start by design; (b) an end-to-end Custom REST call logged by a controlled endpoint (the external IP-echo check from the same containers and network path is the stand-in); (c) a rule-by-rule review of anything beyond what is listed above; (d) any third-party allowlist check.

**Remaining O-2 verification and approval gates (as of 2026-10-10); O-2 is NOT fully closed:**
1. **Controlled Custom REST egress test (open):** a Custom REST test call from the web service and a worker sync against a controlled endpoint that logs the source address, both showing 13.62.74.24. The external IP-echo check from the same containers is only a stand-in.
2. **Host stop/start persistence test (open, not claimed):** interrupts production, so it needs an approved window; until then only the AWS-side proof exists (the Elastic IP stays associated across stop/start by design).
3. **Third-party IP allowlist inventory (open, owner records):** which systems reference 13.62.74.24 (Zendesk, Jira, Linear, Intercom OAuth redirect URIs and webhook URLs, the ops SMTP relay, Sentry, partner or customer firewalls). Nearly all probably do because the app is served by IP.
4. **Qualified legal review of W-3 (open, separate gate):** what customers may be told about the address and any stability or change-notice commitment; plus the reviewer's decisions on the rest of Part B.
5. **Address protection (open, owner decision):** who may release or disassociate the Elastic IP; it is also the application's public URL (`NEXTAUTH_URL`).
Closed for O-2: the address exists, is an Elastic IP on the instance's primary interface, public subnet via an internet gateway with no NAT and no IPv6, security group and NACL read, and web plus all three workers verified to egress through it (IPv4). Optional/separate: show the address in the setup page; a domain for the app; the SSH decision above.

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
