import { parseZendeskTicketId } from "@sla/zendesk/src/ticket-url";
import type { JiraIssueRecord } from "./jira";
import type { ZendeskCase } from "./zendesk";

export interface CaseIssueLink {
  ticketId: string;
  issueKey: string;
  /** Which side of the export carried the reference. */
  via: "jira" | "zendesk";
}

export interface LinkCoverage {
  jiraIssues: number;
  /** Issues that reference a Zendesk ticket, from either side of the export. */
  issuesReferencingTicket: number;
  issuesLinked: number;
  /** Referenced a ticket id that isn't in the tickets export (often outside its date range). */
  issuesTicketNotInExport: number;
  /** Had link-column values, but none was a ticket on this Zendesk subdomain. */
  issuesNotZendeskReference: number;
  /** Zendesk ticket URLs that couldn't be checked because `--zendesk-subdomain` wasn't given. */
  issuesUrlWithoutSubdomain: number;
  /** Ticket-side Jira keys whose issue isn't in the issues export. */
  ticketReferencesIssueNotInExport: number;
  ticketsLinked: number;
}

export interface CorrelationResult {
  links: CaseIssueLink[];
  coverage: LinkCoverage;
}

function tokens(values: string[]): string[] {
  return values.flatMap((v) => v.split(/[\s,;|]+/)).filter(Boolean);
}

const ZENDESK_URL = /^https?:\/\/[^/]+\.zendesk\.com\//i;

/**
 * Deterministic tier only, as in `packages/jira/src/correlate.ts`: a ticket
 * id in a Zendesk-specific column, a ticket URL on the prospect's own
 * subdomain (checked with the product's `parseZendeskTicketId`), or a Jira
 * key written on the ticket. No title or participant matching. Anything
 * else stays unlinked and is counted by reason.
 */
export function correlateExport(
  tickets: Map<string, ZendeskCase>,
  issues: Map<string, JiraIssueRecord>,
  zendeskSubdomain: string | undefined,
): CorrelationResult {
  const links = new Map<string, CaseIssueLink>();
  const coverage: LinkCoverage = {
    jiraIssues: issues.size,
    issuesReferencingTicket: 0,
    issuesLinked: 0,
    issuesTicketNotInExport: 0,
    issuesNotZendeskReference: 0,
    issuesUrlWithoutSubdomain: 0,
    ticketReferencesIssueNotInExport: 0,
    ticketsLinked: 0,
  };

  const referencedFromTickets = new Map<string, string[]>();
  for (const [ticketId, zendeskCase] of tickets) {
    for (const key of zendeskCase.jiraKeys) {
      if (!issues.has(key)) {
        coverage.ticketReferencesIssueNotInExport += 1;
        continue;
      }
      const group = referencedFromTickets.get(key);
      if (group) group.push(ticketId);
      else referencedFromTickets.set(key, [ticketId]);
    }
  }

  for (const [key, record] of issues) {
    const ticketIds = new Set<string>();
    let urlWithoutSubdomain = false;

    const resolveUrl = (token: string) => {
      if (!/^https?:\/\//i.test(token)) return;
      if (!zendeskSubdomain) {
        if (ZENDESK_URL.test(token)) urlWithoutSubdomain = true;
        return;
      }
      const id = parseZendeskTicketId(token, zendeskSubdomain);
      if (id) ticketIds.add(id);
    };
    for (const token of tokens(record.zendeskValues)) {
      const bare = token.replace(/^#/, "");
      if (/^\d+$/.test(bare)) ticketIds.add(bare);
      else resolveUrl(token);
    }
    for (const token of tokens(record.linkValues)) resolveUrl(token);

    const fromTickets = referencedFromTickets.get(key) ?? [];
    const hadLinkValues = record.zendeskValues.length > 0 || record.linkValues.length > 0;

    if (ticketIds.size === 0 && fromTickets.length === 0) {
      if (urlWithoutSubdomain) coverage.issuesUrlWithoutSubdomain += 1;
      else if (hadLinkValues) coverage.issuesNotZendeskReference += 1;
      continue;
    }
    coverage.issuesReferencingTicket += 1;

    let linked = false;
    for (const ticketId of ticketIds) {
      if (!tickets.has(ticketId)) continue;
      links.set(`${ticketId}|${key}`, { ticketId, issueKey: key, via: "jira" });
      linked = true;
    }
    for (const ticketId of fromTickets) {
      if (!links.has(`${ticketId}|${key}`)) links.set(`${ticketId}|${key}`, { ticketId, issueKey: key, via: "zendesk" });
      linked = true;
    }
    if (linked) coverage.issuesLinked += 1;
    else coverage.issuesTicketNotInExport += 1;
  }

  const sorted = [...links.values()].sort(
    (a, b) => Number(a.ticketId) - Number(b.ticketId) || a.issueKey.localeCompare(b.issueKey),
  );
  coverage.ticketsLinked = new Set(sorted.map((l) => l.ticketId)).size;
  return { links: sorted, coverage };
}
