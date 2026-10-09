/**
 * Verifies dev/acme-desk.custom-rest.config.json against the running lab server
 * (http://127.0.0.1:4100) using Elapsed's own schema, validator, outbound checks
 * and derive pipeline. Read-only: it only issues GETs and writes nothing.
 *
 *   LAB_TOKEN=<token> CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1 \
 *     pnpm --filter @sla/custom-ticket exec tsx dev/verify-acme-desk-config.ts
 *
 * The token is the lab's bearer token (see the lab readme); it is read from the
 * environment and never written to the config.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTicketEvents,
  deriveBatch,
  fetchPage,
  openOutboundSession,
  parseConfig,
  previewMapping,
  sampleSource,
  testConnection,
  validateConfig,
  START,
  type RawRow,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:4100";
const token = process.env.LAB_TOKEN;
if (!token) throw new Error("Set LAB_TOKEN to the lab bearer token.");

const raw = JSON.parse(readFileSync(join(here, "acme-desk.custom-rest.config.json"), "utf8"));
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

// 1. The saved file equals what the server serves right now.
const live = await (await fetch(`${BASE}/elapsed-config.json`)).json();
const diffs: string[] = [];
const walk = (a: unknown, b: unknown, path: string) => {
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
  } else if (a !== b) diffs.push(`${path}: lab=${JSON.stringify(a)} file=${JSON.stringify(b)}`);
};
walk(live, raw, "$");
console.log("differences from live /elapsed-config.json:", diffs.length ? diffs.join("; ") : "none");
check("only the intended difference from the lab's own config (valueMaps.status.closed)", diffs.length === 1 && diffs[0]!.startsWith("$.valueMaps.status.closed"));
check("no secret-looking keys in the document", !/"(token|secret|password|apiKey|headerValue)"\s*:/i.test(JSON.stringify(raw)));

// 2. Zod schema (strict) and the semantic validator.
const parsed = parseConfig(raw);
check("Zod schema (parseConfig)", parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.issues));
if (!parsed.ok) process.exit(1);
const report = validateConfig(parsed.config, { allowPrivateHosts: true });
console.log("validateConfig diagnostics:", JSON.stringify(report.diagnostics));
console.log("validateConfig support:", JSON.stringify(report.support), "requiredSecrets:", JSON.stringify(report.requiredSecrets), "terminalStatuses:", JSON.stringify(report.terminalStatuses));
check("validateConfig ok (no error diagnostics)", report.ok);

// 3. Wizard checks against the live server.
const session = openOutboundSession(parsed.config, { token });
try {
  const test = await testConnection(session);
  check("Test connection", test.classification === "ok", JSON.stringify(test));
  const sample = await sampleSource(session);
  check("Show a sample", sample.classification === "ok" && sample.tickets.length > 0, `itemCount=${sample.itemCount} hasNextPage=${sample.hasNextPage} comments=${sample.comments?.length} history=${sample.history?.length}`);
  const preview = await previewMapping(session);
  check("Preview (first 25)", preview.classification === "ok" && preview.failures.length === 0, `read=${preview.ticketsRead} failures=${JSON.stringify(preview.failures)} diagnostics=${JSON.stringify(preview.diagnostics)}`);

  // 4. Full pass over every page, then compare the derived events with the raw API.
  const items: unknown[] = [];
  let position = START;
  let pages = 0;
  for (;;) {
    const page = await fetchPage(session.client, { request: parsed.config.tickets.request, itemsPath: parsed.config.tickets.itemsPath, pagination: parsed.config.tickets.pagination }, position, {});
    items.push(...page.items);
    pages += 1;
    if (page.next === null) break;
    position = page.next;
  }
  const apiAll = (await (await fetch(`${BASE}/api/tickets?limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json()).data.items as { id: string }[];
  check("pagination walks every ticket exactly once", items.length === apiAll.length && new Set(items.map((i) => (i as { id: string }).id)).size === apiAll.length, `pages=${pages} fetched=${items.length} api=${apiAll.length}`);

  // Multi-page walk: same pagination block with a small page size (not saved), 36 tickets => 4 pages.
  {
    const small = { ...parsed.config.tickets.pagination, pageSize: 10 } as typeof parsed.config.tickets.pagination;
    const seen: string[] = [];
    let pos = START;
    let n = 0;
    for (;;) {
      const page = await fetchPage(session.client, { request: parsed.config.tickets.request, itemsPath: parsed.config.tickets.itemsPath, pagination: small }, pos, {});
      seen.push(...page.items.map((i) => (i as { id: string }).id));
      n += 1;
      if (page.next === null || n > 10) break;
      pos = page.next;
    }
    check("multi-page walk (pageSize 10) reads every ticket once", n === 4 && seen.length === apiAll.length && new Set(seen).size === apiAll.length, `pages=${n} tickets=${seen.length}`);
  }
  // Incremental: {{updatedSince}} must filter to tickets changed since then (TCK-1004 got a comment at 07:24Z).
  {
    const since = "2026-10-09T07:00:00.000Z";
    const page = await fetchPage(session.client, { request: parsed.config.tickets.request, itemsPath: parsed.config.tickets.itemsPath, pagination: parsed.config.tickets.pagination }, START, { updatedSince: since });
    const expected = apiAll.filter((t) => Date.parse((t as unknown as { updated_at: string }).updated_at) > Date.parse(since)).map((t) => t.id).sort();
    const got = page.items.map((i) => (i as { id: string }).id).sort();
    check("incremental updatedSince returns exactly the tickets changed since", JSON.stringify(got) === JSON.stringify(expected) && got.length > 0, `got=${got.join(",")}`);
  }

  const rows: RawRow[] = [];
  for (const item of items) {
    const built = await buildTicketEvents(session.client, parsed.config, item);
    for (const e of built.events) rows.push({ id: `r${rows.length}`, providerEventId: e.providerEventId, payload: e.payload, fetchedAt: new Date(0) });
  }
  const derived = deriveBatch(parsed.config, rows);
  check("derive: no failures", derived.failures.length === 0, JSON.stringify(derived.failures));
  check("derive: no diagnostics", derived.diagnostics.length === 0, JSON.stringify(derived.diagnostics));
  check("derive: one case per ticket", derived.cases.length === apiAll.length, `${derived.cases.length}/${apiAll.length}`);

  const auth = { Authorization: `Bearer ${token}` };
  const api = async <T,>(path: string) => ((await (await fetch(BASE + path, { headers: auth })).json()) as { data: T }).data;
  const groups = new Map(derived.eventGroups.map((g) => [g.recordId, g]));
  const casesById = new Map(derived.cases.map((c) => [c.externalId, c]));
  const typeTotals: Record<string, number> = {};
  const mismatches: string[] = [];
  for (const t of apiAll as { id: string; resolved_at: string | null; status: string }[]) {
    const comments = (await api<{ items: { created_at: string; public: boolean; author: { role: string } }[] }>(`/api/tickets/${t.id}/comments`)).items;
    const history = (await api<{ items: unknown[] }>(`/api/tickets/${t.id}/history`)).items;
    const events = groups.get(t.id)?.events ?? [];
    const statusMap = parsed.config.valueMaps.status;
    const hist = history as { from: string; to: string }[];
    let cur: string | undefined = hist.length ? statusMap[hist[0]!.from] : undefined;
    let expectedStateEvents = 0;
    for (const h of hist) { const next = statusMap[h.to]; if (next !== cur) { expectedStateEvents += 1; cur = next; } }
    const count = (type: string) => events.filter((e) => e.type === type).length;
    for (const e of events) typeTotals[e.type] = (typeTotals[e.type] ?? 0) + 1;
    const publicAgent = comments.filter((c) => c.public && c.author.role === "agent").length;
    const publicCustomerAfterOpening = comments.filter((c) => c.public && c.author.role === "customer").length - 1;
    const stateEvents = count("state_changed") + count("case_closed");
    if (stateEvents !== expectedStateEvents) mismatches.push(`${t.id}: state_changed+case_closed ${stateEvents} != expected ${expectedStateEvents} from history`);
    if (count("agent_replied") !== publicAgent) mismatches.push(`${t.id}: agent_replied ${count("agent_replied")} != public agent comments ${publicAgent}`);
    if (count("customer_replied") !== publicCustomerAfterOpening) mismatches.push(`${t.id}: customer_replied ${count("customer_replied")} != public customer comments after the opening one ${publicCustomerAfterOpening}`);
    if (count("case_created") !== 1) mismatches.push(`${t.id}: case_created ${count("case_created")}`);
    const closedAt = casesById.get(t.id)?.closedAt?.toISOString() ?? null;
    if (closedAt !== t.resolved_at) mismatches.push(`${t.id}: closedAt ${closedAt} != resolved_at ${t.resolved_at}`);
    const firstAgent = comments.find((c) => c.public && c.author.role === "agent")?.created_at ?? null;
    const derivedFirstAgent = events.find((e) => e.type === "agent_replied")?.occurredAt.toISOString() ?? null;
    if (firstAgent !== derivedFirstAgent) mismatches.push(`${t.id}: first agent reply ${derivedFirstAgent} != ${firstAgent}`);
  }
  console.log("derived event totals:", JSON.stringify(typeTotals));
  check("derived events match the raw API for all tickets (replies, transitions, first response, closure)", mismatches.length === 0, mismatches.slice(0, 10).join(" | "));
} finally {
  await session.dispose();
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
