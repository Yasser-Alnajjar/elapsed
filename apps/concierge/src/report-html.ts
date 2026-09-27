import { ENGINEERING_LEG_WARN_AT_PERCENT, type Leg } from "@sla/core";
import { LEGS, type CaseResult, type Findings } from "./analyze";
import {
  LEG_LABELS,
  coverageNoteLines,
  day,
  describeCalendar,
  methodNoteLines,
  percent,
  plural,
  type ReportOptions,
} from "./report";
import { formatMinutes } from "./time";

/**
 * The findings page as a standalone HTML document, laid out like the product's
 * escalation report (`apps/web/stitch_elapsed/escalation_findings_*`): KPI
 * tiles, link coverage, time by leg, ownership at breach, and the methodology.
 * Everything is inline (no CDN fonts or scripts) because the page carries a
 * prospect's ticket data and is opened straight from disk. Numbers come from
 * the same `Findings` and helpers as the Markdown report.
 */

const LEG_COLORS: Record<Leg, string> = {
  support: "var(--primary)",
  engineering: "var(--primary-strong)",
  waiting_customer: "var(--subtle)",
  unknown: "var(--warning)",
};

function esc(text: string | number): string {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function ticketCell(c: CaseResult, options: ReportOptions): string {
  const label = `#${esc(c.ticketId)}`;
  if (!options.zendeskSubdomain) return `<span class="mono strong">${label}</span>`;
  const href = `https://${options.zendeskSubdomain}.zendesk.com/agent/tickets/${c.ticketId}`;
  return `<a class="mono strong" href="${esc(href)}">${label}</a>`;
}

function reportId(findings: Findings, company: string | undefined): string {
  const initials = (company ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();
  return `RPT-${day(findings.asOf).replace(/-/g, "")}${initials ? `-${initials}` : ""}`;
}

function badge(text: string, tone: "primary" | "danger" | "warning" | "success" | "muted"): string {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function card(title: string, body: string, opts: { aside?: string; span?: number; tone?: string } = {}): string {
  return `<section class="card span-${opts.span ?? 6}">
<div class="card-head"><h2>${esc(title)}</h2>${opts.aside ?? ""}</div>
${body}
</section>`;
}

function table(header: { label: string; right?: boolean }[], rows: string[][]): string {
  return `<div class="table-wrap"><table><thead><tr>${header
    .map((h) => `<th${h.right ? ' class="r"' : ""}>${esc(h.label)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, i) => `<td${header[i]?.right ? ' class="r"' : ""}>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function kpi(label: string, value: string, unit: string, footLeft: string, footRight: string, tone: "" | "danger" | "primary" = ""): string {
  return `<div class="kpi ${tone}">
<div class="kpi-label">${esc(label)}</div>
<div class="kpi-value"><span class="num">${esc(value)}</span><span class="unit">${esc(unit)}</span></div>
<div class="kpi-foot"><span>${esc(footLeft)}</span><span class="mono">${esc(footRight)}</span></div>
</div>`;
}

function kpis(findings: Findings): string {
  const { escalated, notEscalated } = findings;
  const reachedEngineering = findings.cases.filter((c) => c.jiraKeys.length > 0 && c.legMinutes.engineering > 0);
  const avgEngineering = reachedEngineering.length > 0 ? findings.legTotals.engineering / reachedEngineering.length : null;
  return `<div class="kpis">
${kpi("Escalated tickets", String(escalated.cases), "to Jira", `${escalated.cases} of ${plural(findings.tickets, "ticket")}`, `${percent(escalated.cases, findings.tickets)} rate`)}
${kpi(
  "Resolution breaches",
  String(escalated.breached),
  "exceeded target",
  "Escalated tickets past target",
  escalated.evaluated > 0 ? `${percent(escalated.breached, escalated.evaluated)} of ${escalated.evaluated}` : "none evaluated",
  escalated.breached > 0 ? "danger" : "",
)}
${kpi(
  "Support-only breaches",
  notEscalated.evaluated > 0 ? percent(notEscalated.breached, notEscalated.evaluated) : "—",
  "breach rate",
  `${notEscalated.cases} ${notEscalated.cases === 1 ? "ticket" : "tickets"} stayed in support`,
  `${notEscalated.breached} breached`,
)}
${kpi(
  "Avg. engineering time",
  avgEngineering === null ? "—" : formatMinutes(avgEngineering),
  avgEngineering === null ? "" : "/ ticket",
  "Per escalated ticket",
  `${formatMinutes(findings.legTotals.engineering)} total`,
  avgEngineering === null ? "" : "primary",
)}
</div>`;
}

function linkCoverage(findings: Findings): string {
  const { coverage } = findings;
  const pct = percent(coverage.issuesLinked, coverage.issuesReferencingTicket);
  const notes = coverageNoteLines(coverage);
  const body = `<div class="big-stat"><span class="num ${coverage.issuesLinked === coverage.issuesReferencingTicket && coverage.issuesReferencingTicket > 0 ? "success" : ""}">${pct}</span>
<span class="cap">of referencing issues linked</span></div>
<p class="lede"><strong>${coverage.issuesLinked} of ${coverage.issuesReferencingTicket}</strong> Jira issues that reference a Zendesk ticket were linked. Unlinked issues are never assigned to a ticket by guesswork, so they don't count toward any number here.</p>
${notes.length > 0 ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
  return card("Link coverage", body, {
    span: 4,
    aside: badge(`${coverage.issuesLinked} linked`, coverage.issuesLinked > 0 ? "success" : "muted"),
  });
}

function timeByLeg(findings: Findings): string {
  const total = LEGS.reduce((sum, leg) => sum + findings.legTotals[leg], 0);
  const legs = LEGS.filter((leg) => findings.legTotals[leg] > 0);
  const dominant = legs.reduce<Leg | null>((best, leg) => (best === null || findings.legTotals[leg] > findings.legTotals[best] ? leg : best), null);
  const cases = findings.escalated.cases;
  const body = `<p class="lede">Wall-clock time from ticket creation to its last solve, or the evaluation date if still open, split by who held the ticket.</p>
<div class="stack" role="img" aria-label="Time by owner">${legs
    .map((leg) => `<span style="width:${(findings.legTotals[leg] / total) * 100}%;background:${LEG_COLORS[leg]}" title="${esc(LEG_LABELS[leg]!)}: ${percent(findings.legTotals[leg], total)}"></span>`)
    .join("")}</div>
${table(
  [{ label: "Owner" }, { label: "Total", right: true }, { label: "Avg per ticket", right: true }, { label: "Share" }],
  legs.map((leg) => [
    `<span class="dot" style="background:${LEG_COLORS[leg]}"></span>${esc(LEG_LABELS[leg]!)}${leg === dominant && legs.length > 1 ? ` ${badge("dominant", "primary")}` : ""}`,
    `<span class="mono">${formatMinutes(findings.legTotals[leg])}</span>`,
    `<span class="mono muted">${formatMinutes(findings.legTotals[leg] / cases)}</span>`,
    `<span class="bar"><span style="width:${(findings.legTotals[leg] / total) * 100}%;background:${LEG_COLORS[leg]}"></span></span><span class="mono">${percent(findings.legTotals[leg], total)}</span>`,
  ]),
)}`;
  return card("Where escalated tickets spent their time", body, { span: 8, aside: `<span class="hint">Creation → last solve or evaluation</span>` });
}

function ownerAtBreach(findings: Findings): string {
  const legs = LEGS.filter((leg) => findings.breachLegs[leg] > 0);
  const body =
    legs.length === 0
      ? `<p class="lede">No ticket exceeded its resolution target.</p>`
      : `<p class="lede">Who owned the ticket at the moment its resolution target was exceeded.</p>${table(
          [{ label: "Owner at breach" }, { label: "Tickets", right: true }, { label: "% of breaches", right: true }],
          legs.map((leg) => [
            esc(LEG_LABELS[leg]!),
            `<span class="mono strong">${findings.breachLegs[leg]}</span>`,
            `<span class="mono warning">${percent(findings.breachLegs[leg], findings.breached)}</span>`,
          ]),
        )}`;
  return card("Who held the ticket when the target passed", body, { span: 6 });
}

function zendeskTimer(findings: Findings, options: ReportOptions): string {
  const timer = findings.zendeskTimer;
  if (!timer.columnPresent) {
    return card(
      "Where Zendesk's own timer disagrees",
      `<div class="callout"><strong>Comparison unavailable</strong><p>The tickets export has no SLA-breach column, so this comparison wasn't run. Add Zendesk's resolution-breach field to the export to see it.</p></div>`,
      { span: 6, aside: badge("inactive", "muted") },
    );
  }
  const disagreements = [
    ...timer.engineBreachedZendeskNot.map((c) => ({ c, verdict: "Breached here, met in Zendesk" })),
    ...timer.zendeskBreachedEngineNot.map((c) => ({ c, verdict: "Breached in Zendesk, not here" })),
  ];
  const body = `<p class="lede">Compared ${plural(timer.compared, "ticket")}: the engine and Zendesk agree on <strong>${timer.agree} (${percent(timer.agree, timer.compared)})</strong>.</p>${
    disagreements.length === 0
      ? ""
      : `${table(
          [{ label: "Ticket" }, { label: "Account" }, { label: "Verdicts" }, { label: "Status" }],
          disagreements.slice(0, 10).map(({ c, verdict }) => [ticketCell(c, options), esc(c.account ?? "—"), esc(verdict), esc(c.status ?? "—")]),
        )}<p class="hint">Each one is a difference in targets, business hours or pause rules, or a bug. Check these first on the call.</p>`
  }`;
  return card("Where Zendesk's own timer disagrees", body, {
    span: 6,
    aside: badge(disagreements.length === 0 ? "all agree" : `${disagreements.length} differ`, disagreements.length === 0 ? "success" : "warning"),
  });
}

function agingInEngineering(findings: Findings, options: ReportOptions): string {
  const { agingInEngineering: aging } = findings;
  let body: string;
  if (aging.total === 0) body = `<p class="lede">No open escalations are sitting with engineering right now.</p>`;
  else
    body = `<p class="lede">${plural(aging.total, "open escalation")} ${aging.total === 1 ? "is" : "are"} with engineering now. Longest first.</p>${table(
      [{ label: "Ticket" }, { label: "Account" }, { label: "Jira" }, { label: "In eng.", right: true }, { label: "Target" }],
      aging.cases.map((c) => [
        ticketCell(c, options),
        esc(c.account ?? "—"),
        `<span class="mono">${esc(c.jiraKeys.join(", "))}</span>`,
        `<span class="mono warning">${formatMinutes(c.legMinutes.engineering)}</span>`,
        c.status === "breached" ? badge("breached", "danger") : esc(c.status ?? "no target"),
      ]),
    )}`;
  if (findings.engineeringTarget && findings.engineeringTargetMinutes) {
    body += `<p class="lede">Against a ${formatMinutes(findings.engineeringTargetMinutes)} engineering target: <strong>${findings.engineeringTarget.breached} exceeded</strong>, ${findings.engineeringTarget.atRisk} open and past ${ENGINEERING_LEG_WARN_AT_PERCENT}% of it.</p>`;
  }
  return card("Escalations aging in engineering", body, {
    span: 6,
    aside: aging.total > 0 ? badge(`${aging.total} open`, "warning") : "",
  });
}

function worstBreaches(findings: Findings, options: ReportOptions): string {
  const rows = findings.worstEscalatedBreaches;
  const body =
    rows.length === 0
      ? `<p class="lede">No escalated ticket exceeded its resolution target.</p>`
      : `<p class="lede">Ranked by how far past the target each ticket ran.</p>${table(
          [{ label: "Ticket" }, { label: "Account" }, { label: "Jira" }, { label: "Over target", right: true }, { label: "Owner at breach" }],
          rows.map((c) => [
            ticketCell(c, options),
            esc(c.account ?? "—"),
            `<span class="mono">${esc(c.jiraKeys.join(", "))}</span>`,
            `<span class="mono danger">+${formatMinutes(c.breachedByMinutes ?? 0)}</span>`,
            c.legAtBreach ? badge(LEG_LABELS[c.legAtBreach]!, c.legAtBreach === "engineering" ? "primary" : "muted") : "—",
          ]),
        )}`;
  return card("Largest escalated breaches", body, { span: 6, aside: `<span class="hint">Ranked by deviation</span>` });
}

function topAccounts(findings: Findings): string {
  if (findings.topAccounts.length === 0) return "";
  return card(
    "Top affected accounts",
    table(
      [{ label: "Account" }, { label: "Escalations", right: true }, { label: "Exceeded target", right: true }, { label: "Breach frequency", right: true }],
      findings.topAccounts.map((a) => [
        `<span class="strong">${esc(a.account)}</span>`,
        `<span class="mono">${a.escalated}</span>`,
        `<span class="mono ${a.breached > 0 ? "danger" : ""}">${a.breached}</span>`,
        `<span class="mono">${percent(a.breached, a.escalated)}</span>`,
      ]),
    ),
    { span: 12, aside: `<span class="hint">Account concentration</span>` },
  );
}

function methodology(findings: Findings): string {
  const matrix = findings.targets
    .map((t) => `<div class="target"><span class="tl">${esc(t.priority ?? (findings.targets.length > 1 ? "other" : "all tickets"))}</span><span class="tv mono">${formatMinutes(t.minutes)}</span></div>`)
    .join("");
  // The first note restates the targets and hours, which the matrix above already shows.
  const notes = methodNoteLines(findings).slice(1);
  const body = `<div class="targets">${matrix}</div>
<p class="lede">Business hours: ${esc(describeCalendar(findings))}.</p>
<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  return card("How this was calculated", body, { span: 12, aside: `<span class="hint">Methodology &amp; constraints</span>` });
}

function dataSources(findings: Findings): string {
  const files = findings.dataQuality.files;
  const rows = files.reduce((sum, f) => sum + f.rows, 0);
  const used = files.reduce((sum, f) => sum + f.used, 0);
  return card(
    "Data sources",
    table(
      [{ label: "File" }, { label: "Rows", right: true }, { label: "Used", right: true }, { label: "Dropped" }],
      files.map((f) => [
        esc(f.file),
        `<span class="mono">${f.rows}</span>`,
        `<span class="mono">${f.used}</span>`,
        f.dropped.length === 0 ? `<span class="mono muted">0</span>` : `<span class="warning">${esc(f.dropped.map((d) => `${d.count} ${d.reason}`).join("; "))}</span>`,
      ]),
    ),
    { span: 12, aside: badge(`${used} of ${rows} rows used`, used === rows ? "success" : "warning") },
  );
}

const STYLES = `
:root {
  color-scheme: light;
  --canvas: #f1f5f9; --surface: #ffffff; --raised: #f8fafc; --hover: #e2e8f0; --border: #e2e8f0; --border-strong: #cbd5e1; --mast: #f1f5f9;
  --primary: #0369a1; --primary-strong: #0ea5e9; --text: #0f172a; --body: #1e293b; --muted: #475569; --subtle: #64748b;
  --danger: #e11d48; --warning: #b45309; --success: #059669;
  --warn-bg: #fffbeb; --warn-border: #fcd34d; --warn-text: #92400e; --row-line: #e2e8f0; --row-hover: #f1f5f9;
  --sans: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark;
  --canvas: #060a12; --surface: #0b1324; --raised: #111c34; --hover: #1c2a47; --border: #1c273c; --border-strong: #2d3c59; --mast: #0d162c;
  --primary: #89ceff; --primary-strong: #0ea5e9; --text: #f8fafc; --body: #e2e8f0; --muted: #94a3b8; --subtle: #64748b;
  --danger: #f43f5e; --warning: #f59e0b; --success: #10b981;
  --warn-bg: rgba(245,158,11,.08); --warn-border: rgba(245,158,11,.3); --warn-text: #fde68a; --row-line: rgba(28,39,60,.6); --row-hover: rgba(28,42,71,.5); } }
:root[data-theme="dark"] { color-scheme: dark;
  --canvas: #060a12; --surface: #0b1324; --raised: #111c34; --hover: #1c2a47; --border: #1c273c; --border-strong: #2d3c59; --mast: #0d162c;
  --primary: #89ceff; --primary-strong: #0ea5e9; --text: #f8fafc; --body: #e2e8f0; --muted: #94a3b8; --subtle: #64748b;
  --danger: #f43f5e; --warning: #f59e0b; --success: #10b981;
  --warn-bg: rgba(245,158,11,.08); --warn-border: rgba(245,158,11,.3); --warn-text: #fde68a; --row-line: rgba(28,39,60,.6); --row-hover: rgba(28,42,71,.5); }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--surface); color: var(--body); font: 14px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
body { min-height: 100vh; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.page { min-height: 100vh; display: flex; flex-direction: column; background: var(--surface); }
.page > .body { flex: 1; width: 100%; max-width: 1600px; margin: 0 auto; }
.mast { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 32px; border-bottom: 1px solid var(--border); background: var(--mast); }
.actions { display: flex; gap: 8px; }
.brand { display: flex; flex-direction: column; gap: 2px; }
.brand b { font: 700 14px var(--mono); letter-spacing: -0.01em; color: var(--text); }
.eyebrow { font: 500 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--subtle); }
.rid { font: 11px var(--mono); color: var(--muted); border: 1px solid var(--border); padding: 5px 12px; border-radius: 6px; background: var(--surface); }
.rid b { color: var(--primary); font-weight: 500; }
button { font: 13px var(--sans); color: var(--text); background: var(--raised); border: 1px solid var(--border); padding: 6px 12px; border-radius: 6px; cursor: pointer; }
button:hover { background: var(--hover); border-color: var(--border-strong); }
.body { padding: 32px; display: flex; flex-direction: column; gap: 24px; }
.title { display: flex; flex-direction: column; gap: 10px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
h1 { margin: 0; font-size: 30px; line-height: 1.15; letter-spacing: -0.02em; color: var(--text); }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; background: var(--raised); border: 1px solid var(--border); font: 600 11px var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--body); }
.chip.accent { background: rgba(14,165,233,.1); border-color: rgba(14,165,233,.3); color: var(--primary); }
.meta { display: flex; flex-wrap: wrap; gap: 6px 20px; font: 12px var(--mono); color: var(--muted); }
.meta b { color: var(--text); font-weight: 500; }
.empty { padding: 16px 20px; border-radius: 8px; background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn-text); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.kpi { display: flex; flex-direction: column; justify-content: space-between; gap: 6px; padding: 16px; border-radius: 8px; background: var(--raised); border: 1px solid var(--border); }
.kpi.danger { border-color: rgba(244,63,94,.4); box-shadow: inset -4px 0 0 var(--danger); }
.kpi-label { font: 500 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--subtle); }
.kpi.danger .kpi-label, .kpi.danger .num { color: var(--danger); }
.kpi.primary .num { color: var(--primary); }
.kpi-value { display: flex; align-items: baseline; gap: 8px; }
.num { font: 700 32px/1.1 var(--mono); color: var(--text); font-variant-numeric: tabular-nums; }
.num.success { color: var(--success); }
.unit { font: 12px var(--mono); color: var(--muted); }
.kpi-foot { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); font: 12px var(--mono); color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; }
.card { padding: 20px; border-radius: 8px; background: var(--raised); border: 1px solid var(--border); min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.span-4 { grid-column: span 4; } .span-6 { grid-column: span 6; } .span-8 { grid-column: span 8; } .span-12 { grid-column: span 12; }
@media (max-width: 1000px) { .span-4, .span-6, .span-8 { grid-column: span 12; } .body { padding: 16px; } .mast { padding: 12px 16px; } }
.card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
h2 { margin: 0; font: 600 15px var(--mono); color: var(--text); }
.hint { font: 11px var(--mono); color: var(--subtle); }
.lede { margin: 0; color: var(--muted); line-height: 1.6; }
.lede strong { color: var(--text); }
.big-stat { display: flex; align-items: baseline; gap: 12px; }
.big-stat .num { font-size: 42px; line-height: 1; }
.cap { font: 10px var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--subtle); }
.notes { margin: 0; padding: 12px 12px 12px 28px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: 13px; }
.notes li { margin: 4px 0; }
.callout { padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--muted); }
.callout strong { color: var(--text); } .callout p { margin: 4px 0 0; }
.stack { display: flex; gap: 2px; height: 16px; padding: 2px; border-radius: 4px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
.stack span { display: block; height: 100%; border-radius: 2px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { padding: 10px 12px; text-align: left; background: var(--surface); font: 600 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--subtle); border-bottom: 1px solid var(--border); white-space: nowrap; }
td { padding: 10px 12px; border-bottom: 1px solid var(--row-line); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: var(--row-hover); }
.r { text-align: right; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.strong { font-weight: 600; color: var(--text); }
.muted { color: var(--muted); } .danger { color: var(--danger); } .warning { color: var(--warning); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
.bar { display: inline-block; width: 90px; height: 6px; margin-right: 8px; vertical-align: middle; background: var(--surface); border-radius: 3px; overflow: hidden; }
.bar span { display: block; height: 100%; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font: 600 10px var(--mono); letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid; }
.badge.primary { color: var(--primary); background: rgba(137,206,255,.1); border-color: rgba(137,206,255,.3); }
.badge.danger { color: var(--danger); background: rgba(244,63,94,.1); border-color: rgba(244,63,94,.3); }
.badge.warning { color: var(--warning); background: rgba(245,158,11,.1); border-color: rgba(245,158,11,.3); }
.badge.success { color: var(--success); background: rgba(16,185,129,.1); border-color: rgba(16,185,129,.3); }
.badge.muted { color: var(--subtle); background: var(--surface); border-color: var(--border-strong); }
.targets { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.target { padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; display: flex; flex-direction: column; gap: 2px; }
.tl { font: 600 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--primary); }
.tv { font-size: 18px; font-weight: 600; color: var(--text); }
.foot { padding: 14px 32px; border-top: 1px solid var(--border); background: var(--mast); font: 10px var(--mono); color: var(--subtle); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
@media print {
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .card { break-inside: avoid; }
}
`;

export function renderHtml(findings: Findings, options: ReportOptions = {}): string {
  const heading = options.company ? `Escalation findings: ${options.company}` : "Escalation findings";
  const id = reportId(findings, options.company);
  const period =
    findings.periodStart && findings.periodEnd
      ? `Tickets opened <b>${esc(day(findings.periodStart))} → ${esc(day(findings.periodEnd))}</b>`
      : "";
  const escalated = findings.escalated.cases > 0;

  const sections = [
    escalated ? "" : `<div class="empty">None of the ${plural(findings.tickets, "ticket")} in this export could be linked to a Jira issue, so there are no escalations to analyze. See link coverage below.</div>`,
    kpis(findings),
    `<div class="grid">
${linkCoverage(findings)}
${escalated ? timeByLeg(findings) : ""}
${findings.breached > 0 ? ownerAtBreach(findings) : ""}
${zendeskTimer(findings, options)}
${agingInEngineering(findings, options)}
${escalated ? worstBreaches(findings, options) : ""}
${topAccounts(findings)}
${methodology(findings)}
${dataSources(findings)}
</div>`,
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>${STYLES}</style>
</head>
<body>
<main class="page">
<header class="mast">
<div class="brand"><b>ELAPSED</b><span class="eyebrow">Deterministic SLA metrology &amp; correlation</span></div>
<div class="rid">REPORT ID: <b>${esc(id)}</b></div>
<div class="actions no-print"><button type="button" id="theme">Theme</button><button type="button" onclick="window.print()">Print / PDF</button></div>
</header>
<div class="body">
<section class="title">
<div class="eyebrow">Reports / Escalation analysis${options.company ? ` / ${esc(options.company)}` : ""}</div>
<div class="title-row">
<h1>Escalation findings</h1>
${options.company ? `<span class="chip">${esc(options.company)}</span>` : ""}
<span class="chip accent">Zendesk + Jira replay</span>
</div>
<div class="meta"><span>${period}</span><span>Evaluated <b>${esc(day(findings.asOf))}</b></span><span>Hours <b>${esc(describeCalendar(findings))}</b></span></div>
</section>
${sections.join("\n")}
</div>
<footer class="foot"><span>Computed locally from the supplied exports. No data left this machine.</span><span>${esc(id)}</span></footer>
</main>
<script>document.getElementById("theme").onclick=function(){var r=document.documentElement,d=r.dataset.theme?r.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;r.dataset.theme=d?"light":"dark"}</script>
</body>
</html>
`;
}
