import { ENGINEERING_LEG_WARN_AT_PERCENT } from "@sla/core";
import { LEGS, type CaseResult, type Findings } from "./analyze";
import type { LinkCoverage } from "./correlate";
import { formatMinutes } from "./time";

/**
 * The findings page as a small block list, rendered to Markdown or HTML, so
 * both formats always say the same thing. Framing follows the product's
 * `/onboarding/findings` screen: escalations, how many exceeded the
 * resolution target, time by leg, and the accounts most affected.
 */
type Inline = string | { strong: string } | { link: string; href: string };
type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; parts: Inline[] }
  | { kind: "muted"; text: string }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; header: string[]; rows: Inline[][] };

export interface ReportOptions {
  company?: string;
  zendeskSubdomain?: string;
}

export const LEG_LABELS: Record<string, string> = {
  support: "Support",
  engineering: "Engineering",
  waiting_customer: "Waiting on customer",
  unknown: "Unknown",
};

export function percent(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function verb(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function day(iso: string): string {
  return iso.slice(0, 10);
}

function ticketRef(c: CaseResult, options: ReportOptions): Inline {
  const label = `#${c.ticketId}`;
  return options.zendeskSubdomain
    ? { link: label, href: `https://${options.zendeskSubdomain}.zendesk.com/agent/tickets/${c.ticketId}` }
    : label;
}

export function describeTargets(findings: Findings): string {
  return findings.targets
    .map((t) => `${t.priority ?? (findings.targets.length > 1 ? "any other priority" : "every ticket")}: ${formatMinutes(t.minutes)}`)
    .join(", ");
}

export function describeCalendar(findings: Findings): string {
  const { calendar } = findings;
  if (calendar.alwaysOpen) return `24/7 (calendar time), ${calendar.timezone}`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const windows = calendar.weekly
    .map((w) => {
      const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      return `${days[w.day]} ${clock(w.openMinute)}–${clock(w.closeMinute)}`;
    })
    .join(", ");
  const holidays = calendar.holidays.length > 0 ? `; holidays ${calendar.holidays.join(", ")}` : "";
  return `${windows} (${calendar.timezone})${holidays}`;
}

/** Plain-language caveats on link coverage, shared by the Markdown and HTML reports. */
export function coverageNoteLines(coverage: LinkCoverage): string[] {
  const notes: string[] = [];
  if (coverage.issuesTicketNotInExport > 0)
    notes.push(`${plural(coverage.issuesTicketNotInExport, "issue")} ${verb(coverage.issuesTicketNotInExport, "points", "point")} at tickets that aren't in the tickets export (often outside its date range).`);
  if (coverage.issuesUrlWithoutSubdomain > 0)
    notes.push(`${plural(coverage.issuesUrlWithoutSubdomain, "issue")} ${verb(coverage.issuesUrlWithoutSubdomain, "links", "link")} to a Zendesk URL, but no --zendesk-subdomain was given to confirm it's this account.`);
  if (coverage.issuesNotZendeskReference > 0)
    notes.push(`${plural(coverage.issuesNotZendeskReference, "issue")} ${verb(coverage.issuesNotZendeskReference, "has", "have")} link values that aren't tickets on this Zendesk account.`);
  if (coverage.ticketReferencesIssueNotInExport > 0)
    notes.push(`${plural(coverage.ticketReferencesIssueNotInExport, "Jira reference")} on tickets ${verb(coverage.ticketReferencesIssueNotInExport, "points", "point")} at issues that aren't in the Jira export.`);
  const noReference = coverage.jiraIssues - coverage.issuesReferencingTicket - coverage.issuesUrlWithoutSubdomain - coverage.issuesNotZendeskReference;
  if (noReference > 0) notes.push(`${plural(noReference, "Jira issue")} ${verb(noReference, "references", "reference")} no ticket at all (internal engineering work, as expected).`);
  return notes;
}

/** The "how this was calculated" caveats, shared by the Markdown and HTML reports. */
export function methodNoteLines(findings: Findings): string[] {
  const quality = findings.dataQuality;
  const notes: string[] = [
    `Resolution targets: ${describeTargets(findings)}. Business hours: ${describeCalendar(findings)}.`,
    `The clock pauses while a ticket is pending on the customer. Targets and hours were given for this analysis; exports don't include SLA policies.`,
    "Escalation time starts when the linked Jira issue was created. Exports don't record when the link was made.",
  ];
  if (findings.ticketsWithoutTarget > 0)
    notes.push(`${plural(findings.ticketsWithoutTarget, "ticket")} had a priority with no target and ${verb(findings.ticketsWithoutTarget, "wasn't", "weren't")} evaluated.`);
  if (quality.closedTicketsWithoutHistory.length > 0)
    notes.push(`${plural(quality.closedTicketsWithoutHistory.length, "solved ticket")} had no status history in the audits export and ${verb(quality.closedTicketsWithoutHistory.length, "wasn't", "weren't")} evaluated.`);
  if (quality.issuesWithoutChangelog.length > 0)
    notes.push(`${plural(quality.issuesWithoutChangelog.length, "linked issue")} had no changelog rows, so only their current status is known: ${quality.issuesWithoutChangelog.slice(0, 10).join(", ")}.`);
  if (quality.casesWithLegWarnings > 0)
    notes.push(`${plural(quality.casesWithLegWarnings, "ticket")} had ambiguous ownership handoffs, counted as Unknown.`);
  const assumed = quality.assumedJiraStatuses.filter((s) => s.source === "stock default");
  if (assumed.length > 0)
    notes.push(`Jira statuses mapped by name (confirm with the customer): ${assumed.map((s) => `${s.name} → ${s.category}`).join(", ")}.`);
  if (quality.unknownJiraStatuses.length > 0)
    notes.push(`Jira statuses with no known category, rows dropped (pass --jira-status): ${quality.unknownJiraStatuses.map((s) => `${s.name} (${s.rows})`).join(", ")}.`);
  return notes;
}

export function buildReport(findings: Findings, options: ReportOptions = {}): Block[] {
  const blocks: Block[] = [];
  const { escalated, notEscalated, coverage } = findings;

  blocks.push({ kind: "title", text: options.company ? `Escalation findings: ${options.company}` : "Escalation findings" });
  blocks.push({
    kind: "muted",
    text:
      findings.periodStart && findings.periodEnd
        ? `Tickets opened ${day(findings.periodStart)} to ${day(findings.periodEnd)}, evaluated as of ${day(findings.asOf)}.`
        : `Evaluated as of ${day(findings.asOf)}.`,
  });

  // Headline, in the onboarding findings screen's words.
  if (escalated.cases === 0) {
    blocks.push({
      kind: "paragraph",
      parts: [
        `None of the ${plural(findings.tickets, "ticket")} in this export could be linked to a Jira issue, so there are no escalations to analyze. See link coverage below.`,
      ],
    });
  } else {
    const headline: Inline[] = [
      "In this export, ",
      { strong: String(escalated.cases) },
      ` ${escalated.cases === 1 ? "ticket was" : "tickets were"} escalated to Jira. `,
      { strong: String(escalated.breached) },
      ` of ${escalated.evaluated === escalated.cases ? "them" : `the ${escalated.evaluated} with a target`} exceeded ${escalated.breached === 1 ? "its" : "their"} resolution target.`,
    ];
    if (escalated.evaluated > 0 && notEscalated.evaluated > 0) {
      headline.push(
        ` That's ${percent(escalated.breached, escalated.evaluated)} of escalated tickets, against ${percent(notEscalated.breached, notEscalated.evaluated)} of the ${notEscalated.evaluated} that stayed in support.`,
      );
    }
    // Averaged over tickets that actually reached engineering, as the
    // onboarding findings screen does.
    const reachedEngineering = findings.cases.filter((c) => c.jiraKeys.length > 0 && c.legMinutes.engineering > 0);
    if (reachedEngineering.length > 0) {
      headline.push(
        " Escalated tickets spent an average of ",
        { strong: formatMinutes(findings.legTotals.engineering / reachedEngineering.length) },
        " in engineering.",
      );
    }
    blocks.push({ kind: "paragraph", parts: headline });
  }

  blocks.push({ kind: "heading", text: "Link coverage" });
  blocks.push({
    kind: "paragraph",
    parts: [
      { strong: `Linked ${coverage.issuesLinked} of ${coverage.issuesReferencingTicket} Jira issues that reference a Zendesk ticket (${percent(coverage.issuesLinked, coverage.issuesReferencingTicket)}).` },
      " Unlinked issues are never assigned to a ticket by guesswork, so they don't count toward any number here.",
    ],
  });
  const coverageNotes = coverageNoteLines(coverage);
  if (coverageNotes.length > 0) blocks.push({ kind: "list", items: coverageNotes.map((line) => [line]) });

  if (escalated.cases > 0) {
    blocks.push({ kind: "heading", text: "Where escalated tickets spent their time" });
    const total = LEGS.reduce((sum, leg) => sum + findings.legTotals[leg], 0);
    blocks.push({
      kind: "table",
      header: ["Owner", "Total", "Average per ticket", "Share"],
      rows: LEGS.filter((leg) => findings.legTotals[leg] > 0).map((leg) => [
        LEG_LABELS[leg]!,
        formatMinutes(findings.legTotals[leg]),
        formatMinutes(findings.legTotals[leg] / escalated.cases),
        percent(findings.legTotals[leg], total),
      ]),
    });
    blocks.push({ kind: "muted", text: "Wall-clock time from ticket creation to its last solve (or the evaluation date if still open)." });
  }

  if (findings.breached > 0) {
    blocks.push({ kind: "heading", text: "Who held the ticket when the target passed" });
    blocks.push({
      kind: "table",
      header: ["Owner at breach", "Tickets"],
      rows: LEGS.filter((leg) => findings.breachLegs[leg] > 0).map((leg) => [LEG_LABELS[leg]!, String(findings.breachLegs[leg])]),
    });
  }

  blocks.push({ kind: "heading", text: "Where Zendesk's own timer disagrees" });
  const timer = findings.zendeskTimer;
  if (!timer.columnPresent) {
    blocks.push({
      kind: "paragraph",
      parts: ["The tickets export has no SLA-breach column, so this comparison wasn't run. Add Zendesk's resolution-breach field to the export to see it."],
    });
  } else {
    blocks.push({
      kind: "paragraph",
      parts: [
        `Compared ${plural(timer.compared, "ticket")}: the engine and Zendesk agree on `,
        { strong: `${timer.agree} (${percent(timer.agree, timer.compared)})` },
        ".",
      ],
    });
    const disagreements = [
      ...timer.engineBreachedZendeskNot.map((c) => ({ c, verdict: "Breached here, met in Zendesk" })),
      ...timer.zendeskBreachedEngineNot.map((c) => ({ c, verdict: "Breached in Zendesk, not here" })),
    ];
    if (disagreements.length > 0) {
      blocks.push({
        kind: "table",
        header: ["Ticket", "Account", "Verdicts", "Engine status", "Waiting on customer"],
        rows: disagreements.slice(0, 10).map(({ c, verdict }) => [
          ticketRef(c, options),
          c.account ?? "—",
          verdict,
          c.status ?? "—",
          formatMinutes(c.legMinutes.waiting_customer),
        ]),
      });
      blocks.push({
        kind: "muted",
        text: "Each one is either a difference in targets, business hours or pause rules, or a bug. Check these first on the call.",
      });
    }
  }

  blocks.push({ kind: "heading", text: "Escalations aging in engineering" });
  if (findings.agingInEngineering.total === 0) {
    blocks.push({ kind: "paragraph", parts: ["No open escalations are sitting with engineering right now."] });
  } else {
    blocks.push({
      kind: "paragraph",
      parts: [`${plural(findings.agingInEngineering.total, "open escalation")} ${findings.agingInEngineering.total === 1 ? "is" : "are"} with engineering now. Longest first:`],
    });
    blocks.push({
      kind: "table",
      header: ["Ticket", "Account", "Jira", "In engineering", "Resolution target"],
      rows: findings.agingInEngineering.cases.map((c) => [
        ticketRef(c, options),
        c.account ?? "—",
        c.jiraKeys.join(", "),
        formatMinutes(c.legMinutes.engineering),
        c.status ?? "no target",
      ]),
    });
  }
  if (findings.engineeringTarget && findings.engineeringTargetMinutes) {
    blocks.push({
      kind: "paragraph",
      parts: [
        `Against a ${formatMinutes(findings.engineeringTargetMinutes)} engineering target: `,
        { strong: `${findings.engineeringTarget.breached} exceeded` },
        `, ${findings.engineeringTarget.atRisk} open and past ${ENGINEERING_LEG_WARN_AT_PERCENT}% of it.`,
      ],
    });
  }

  if (findings.worstEscalatedBreaches.length > 0) {
    blocks.push({ kind: "heading", text: "Largest escalated breaches" });
    blocks.push({
      kind: "table",
      header: ["Ticket", "Account", "Jira", "Over target by", "Owner at breach"],
      rows: findings.worstEscalatedBreaches.map((c) => [
        ticketRef(c, options),
        c.account ?? "—",
        c.jiraKeys.join(", "),
        formatMinutes(c.breachedByMinutes ?? 0),
        c.legAtBreach ? LEG_LABELS[c.legAtBreach]! : "—",
      ]),
    });
  }

  if (findings.topAccounts.length > 0) {
    blocks.push({ kind: "heading", text: "Top affected accounts" });
    blocks.push({
      kind: "table",
      header: ["Account", "Escalations", "Exceeded target"],
      rows: findings.topAccounts.map((a) => [a.account, String(a.escalated), String(a.breached)]),
    });
  }

  blocks.push({ kind: "heading", text: "How this was calculated" });
  const quality = findings.dataQuality;
  blocks.push({ kind: "list", items: methodNoteLines(findings).map((line) => [line]) });

  blocks.push({
    kind: "table",
    header: ["File", "Rows", "Used", "Dropped"],
    rows: quality.files.map((f) => [
      f.file,
      String(f.rows),
      String(f.used),
      f.dropped.length === 0 ? "0" : f.dropped.map((d) => `${d.count} ${d.reason}`).join("; "),
    ]),
  });

  return blocks;
}

function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]|<>])/g, "\\$1");
}

function mdInline(parts: Inline[]): string {
  return parts
    .map((part) => {
      if (typeof part === "string") return mdEscape(part);
      if ("strong" in part) return `**${mdEscape(part.strong)}**`;
      return `[${mdEscape(part.link)}](${part.href})`;
    })
    .join("");
}

export function renderMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "title":
        out.push(`# ${mdEscape(block.text)}`);
        break;
      case "heading":
        out.push(`## ${mdEscape(block.text)}`);
        break;
      case "paragraph":
        out.push(mdInline(block.parts));
        break;
      case "muted":
        out.push(`_${mdEscape(block.text)}_`);
        break;
      case "list":
        out.push(block.items.map((item) => `- ${mdInline(item)}`).join("\n"));
        break;
      case "table":
        out.push(
          [
            `| ${block.header.map(mdEscape).join(" | ")} |`,
            `| ${block.header.map(() => "---").join(" | ")} |`,
            ...block.rows.map((row) => `| ${row.map((cell) => mdInline([cell])).join(" | ")} |`),
          ].join("\n"),
        );
        break;
    }
  }
  return out.join("\n\n") + "\n";
}
