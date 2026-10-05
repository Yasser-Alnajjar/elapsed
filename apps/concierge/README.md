# Concierge analysis

> **Superseded plan, tool still present.** The validation-first plan (`plans/05`) that this tool was built for was superseded when the product went live with customers (roadmap D11, Rev 5/6). The code remains as an internal export and analysis aid (for example the `/internal/concierge/*` export pages); it is not part of a current validation programme.

Validation Week 3 (`plans/05`): turn a prospect's Zendesk and Jira CSV exports
into a one-page findings report within 48 hours, with no OAuth, database or UI.

It's a thin CLI around code the product already runs:

- CSV rows become the same `ZendeskTicket`/`ZendeskAudit` and
  `JiraIssue`/changelog shapes the API adapters ingest. They then go through
  `deriveNormalizedEventsForTicket` and `deriveNormalizedEventsForIssue`.
- Correlation is deterministic only: a ticket id in a Zendesk column, a ticket
  URL on the prospect's own subdomain (`parseZendeskTicketId`), or a Jira key
  written on the ticket.
- `packages/core` does the evaluation: `matchPolicyVersion`,
  `createCommitment`, `evaluateCommitment`, `deriveLegSpans`,
  `sumLegMinutes`, and the business-hours calendar.

Everything runs locally. Keep exports and reports in `apps/concierge/data/`,
which git ignores, and delete them once the analysis has been delivered.

## Run

```bash
pnpm --filter @sla/concierge analyze -- \
  --zendesk-tickets apps/concierge/data/acme/tickets.csv \
  --zendesk-audits apps/concierge/data/acme/audits.csv \
  --jira-issues apps/concierge/data/acme/issues.csv \
  --jira-changelog apps/concierge/data/acme/changelog.csv \
  --resolution "urgent=4h,high=8h,default=24h" \
  --business-hours "mon-fri 09:00-17:00" --timezone America/New_York \
  --zendesk-subdomain acme --company Acme \
  --out apps/concierge/data/acme/findings.html
```

`--help` lists every flag. Before a run, ask the prospect for:

- **Resolution targets** per priority (`--resolution`). Exports don't include
  SLA policies. A day is 24h, so write business-hours targets in working
  hours (three 8-hour days is `24h`).
- **Business hours, time zone and holidays** (`--business-hours`,
  `--timezone`, `--holidays`). Without them the clock runs 24/7.
- **The time zone the export was made in** (`--export-timezone`), if its
  timestamps have no offset. Jira's CSV uses the exporting user's zone.
- **Their Zendesk subdomain** (`--zendesk-subdomain`). Without it, ticket
  URLs aren't accepted as links.
- **Custom Jira statuses** (`--jira-status "QA=indeterminate,Won't Do=done"`).
  Stock names (To Do, In Progress, Done, …) are mapped automatically and
  listed in the report so the prospect can confirm them.

Output is Markdown by default. It's HTML or JSON when `--out` ends in
`.html`/`.json`, or when `--format` says so. JSON is the full findings
object, handy for checking a disputed number. A short summary goes to
stderr.

## Input files

Columns are matched by name, ignoring case, spaces and punctuation, never by
position. Extra columns are ignored. Rows that can't be read are dropped and
counted by reason in the report's last table, never guessed at. The
authoritative alias lists are `TICKET_COLUMNS`, `AUDIT_COLUMNS` in
`src/zendesk.ts` and `ISSUE_COLUMNS`, `CHANGELOG_COLUMNS` in `src/jira.ts`.

| File | Required columns | Optional columns |
| --- | --- | --- |
| Zendesk tickets, one row per ticket | `Id`, `Created at`, `Status` | `Subject`, `Priority`, `Organization`, `Requester`, `Via`, `Resolution SLA breached` (yes/no), `Jira issue keys` |
| Zendesk audits, one row per status change | `Ticket ID`, `Created at`, `Previous value`, `Value` | `Field` (non-status rows are ignored), `Author`, `Via` |
| Jira issues, one row per issue | `Issue key`, `Created`, `Status` | `Status Category`, `Summary`, `Reporter`, `Zendesk Ticket IDs`, `Remote Link` (repeatable) |
| Jira changelog, one row per status transition | `Issue key`, `Created`, `From status`, `To status` | `Field`, `From/To status category`, `Author` |

Timestamps can be ISO 8601 (with or without an offset), `YYYY-MM-DD HH:MM`,
or Jira's `01/Sep/26 2:15 PM`.

Neither product exports status history as CSV from its UI. Zendesk audits
come from the Ticket Audits API or an Explore "Updates history" report. The
Jira changelog comes from the issue changelog API or a marketplace export
app. The column layout of a real export is still unverified: adjust aliases
here once the first one arrives, rather than editing the file by hand.

## What the report assumes

- Only the resolution target is evaluated. Exports carry no reply events, so
  first response isn't measured.
- Escalation starts when the linked Jira issue was created, since exports
  don't record when the link was made.
- The clock pauses while a ticket is pending on the customer, the same rule
  the product applies to imported Zendesk policies.
- A ticket that's solved in the export but has no audit rows isn't
  evaluated, since its clock would otherwise run to `--as-of`.

## Tests

`test/fixtures` is a small synthetic export with hand-computed expectations,
documented at the top of `test/concierge.test.ts`. Run `pnpm test` from the
repo root.
