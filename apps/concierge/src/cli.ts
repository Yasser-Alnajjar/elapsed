import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { isValidTimeZone } from "@sla/core";
import { analyzeExport, type Findings } from "./analyze";
import { parseCsv } from "./csv";
import { parseJiraExport, parseStatusOverrides } from "./jira";
import { buildCalendar, buildPolicyVersions, parseResolutionTargets } from "./policy";
import { buildReport, renderMarkdown } from "./report";
import { renderHtml } from "./report-html";
import { parseDuration, parseTimestamp } from "./time";
import { parseZendeskExport } from "./zendesk";

const USAGE = `Concierge escalation analysis: Zendesk + Jira CSV exports -> one-page findings.
Runs locally. Nothing is uploaded or stored.

Usage:
  pnpm --filter @sla/concierge analyze -- \\
    --zendesk-tickets tickets.csv --zendesk-audits audits.csv \\
    --jira-issues issues.csv --jira-changelog changelog.csv \\
    --resolution "urgent=4h,high=8h,default=24h" \\
    --business-hours "mon-fri 09:00-17:00" --timezone America/New_York \\
    --zendesk-subdomain acme --out findings.html

Inputs (all required; column names are matched leniently, see README.md):
  --zendesk-tickets <csv>    One row per ticket
  --zendesk-audits <csv>     One row per ticket status change
  --jira-issues <csv>        One row per issue, with the Zendesk link field
  --jira-changelog <csv>     One row per issue status transition

Targets and hours (exports carry no SLA policy):
  --resolution <spec>        "24h", or per priority "urgent=4h,high=8h,default=24h"
  --engineering-target <d>   Optional engineering-leg target, e.g. "16h"
  --business-hours <spec>    e.g. "mon-fri 09:00-17:00; sat 10:00-14:00" (default: 24/7)
  --timezone <iana>          Business-hours time zone (default: UTC)
  --holidays <dates>         Comma-separated YYYY-MM-DD, no business hours on these days

Reading the export:
  --export-timezone <iana>   Zone for timestamps without an offset (default: --timezone)
  --zendesk-subdomain <name> Accept ticket URLs only on <name>.zendesk.com
  --jira-status <spec>       Status categories, e.g. "QA=indeterminate,Won't Do=done"
  --as-of <timestamp>        Evaluate open tickets as of this time (default: now)

Output:
  --out <path>               Write to a file (default: stdout)
  --format <md|html|json>    Default: from --out's extension, else md
  --company <name>           Shown in the title
`;

export function run(argv: string[], now: Date = new Date()): { output: string; findings?: Findings } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      "zendesk-tickets": { type: "string" },
      "zendesk-audits": { type: "string" },
      "jira-issues": { type: "string" },
      "jira-changelog": { type: "string" },
      resolution: { type: "string" },
      "engineering-target": { type: "string" },
      "business-hours": { type: "string" },
      timezone: { type: "string", default: "UTC" },
      holidays: { type: "string" },
      "export-timezone": { type: "string" },
      "zendesk-subdomain": { type: "string" },
      "jira-status": { type: "string" },
      "as-of": { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      company: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) return { output: USAGE };

  const required = ["zendesk-tickets", "zendesk-audits", "jira-issues", "jira-changelog", "resolution"] as const;
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) throw new UsageError(`Missing ${missing.map((m) => `--${m}`).join(", ")}.`);

  const timeZone = values.timezone!;
  const exportTimeZone = values["export-timezone"] ?? timeZone;
  if (!isValidTimeZone(exportTimeZone)) throw new UsageError(`Unknown time zone "${exportTimeZone}".`);

  let engineeringTargetMinutes: number | undefined;
  if (values["engineering-target"]) {
    const minutes = parseDuration(values["engineering-target"]);
    if (minutes === null) throw new UsageError(`Can't read --engineering-target "${values["engineering-target"]}".`);
    engineeringTargetMinutes = minutes;
  }

  let asOf = now.toISOString();
  if (values["as-of"]) {
    const parsed = parseTimestamp(values["as-of"], exportTimeZone);
    if (!parsed) throw new UsageError(`Can't read --as-of "${values["as-of"]}".`);
    asOf = parsed;
  }

  const format = values.format ?? ({ ".html": "html", ".htm": "html", ".json": "json" }[extname(values.out ?? "").toLowerCase()] ?? "md");
  if (!["md", "html", "json"].includes(format)) throw new UsageError(`--format must be md, html or json.`);

  const subdomain = values["zendesk-subdomain"]?.trim().toLowerCase().replace(/\.zendesk\.com$/, "");
  const policyVersions = buildPolicyVersions(parseResolutionTargets(values.resolution!));
  const calendar = buildCalendar({ timeZone, businessHours: values["business-hours"], holidays: values.holidays });

  const tables = {
    tickets: parseCsv(readFileSync(values["zendesk-tickets"]!, "utf8")),
    audits: parseCsv(readFileSync(values["zendesk-audits"]!, "utf8")),
    issues: parseCsv(readFileSync(values["jira-issues"]!, "utf8")),
    changelog: parseCsv(readFileSync(values["jira-changelog"]!, "utf8")),
  };

  const findings = analyzeExport(
    {
      zendesk: parseZendeskExport(tables.tickets, tables.audits, exportTimeZone),
      jira: parseJiraExport(tables.issues, tables.changelog, exportTimeZone, parseStatusOverrides(values["jira-status"])),
      rowCounts: {
        tickets: tables.tickets.rows.length,
        audits: tables.audits.rows.length,
        issues: tables.issues.rows.length,
        changelog: tables.changelog.rows.length,
      },
    },
    { policyVersions, calendar, asOf, engineeringTargetMinutes, zendeskSubdomain: subdomain },
  );

  const reportOptions = { company: values.company, zendeskSubdomain: subdomain };
  const output =
    format === "json"
      ? JSON.stringify(findings, null, 2) + "\n"
      : format === "html"
        ? renderHtml(findings, reportOptions)
        : renderMarkdown(buildReport(findings, reportOptions));

  if (values.out) writeFileSync(values.out, output, { mode: 0o600 });
  return { output: values.out ? "" : output, findings };
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function summary(findings: Findings): string {
  const { coverage, escalated } = findings;
  const dropped = findings.dataQuality.files.reduce(
    (sum, f) => sum + f.dropped.filter((d) => !d.reason.endsWith("(ignored)")).reduce((s, d) => s + d.count, 0),
    0,
  );
  return [
    `${findings.tickets} tickets, ${escalated.cases} escalated, ${escalated.breached} escalated breaches.`,
    `Linked ${coverage.issuesLinked} of ${coverage.issuesReferencingTicket} Jira issues that reference a ticket.`,
    `${dropped} rows dropped (reasons listed at the end of the report).`,
  ].join("\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  try {
    // `pnpm --filter` runs scripts from the package directory; resolve file
    // paths from where the command was typed instead.
    if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
    // pnpm passes a literal "--" through before the script's own arguments.
    const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
    const { output, findings } = run(args);
    if (output) process.stdout.write(output);
    if (findings) process.stderr.write(summary(findings) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n${error instanceof UsageError || (error as { code?: string }).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? "\nRun with --help for usage.\n" : ""}`);
    process.exitCode = 1;
  }
}
