#!/usr/bin/env node
// Local mock helpdesk for manually testing the Custom REST source (N9).
// Not production code. Listens on 127.0.0.1:4010 (override with PORT).
// Data is deterministic and synthetic; the only credential is a fake key.
//
//   node packages/custom-ticket/dev/mock-helpdesk.mjs
//
// API (JSON, header `X-Api-Key: mock-key-123`):
//   GET /v2/tickets?updated_after=<iso>&cursor=<c>&per_page=<n>   -> { data:[...], meta:{ next_cursor } }
//   GET /v2/tickets/:id/comments                                   -> { comments:[...] }
//   GET /v2/tickets/:id/history                                    -> { entries:[...] }
// Control (no key; for the tester):
//   GET  /__state
//   POST /__control  { mode, delayMs, ticketCount, closeFirst, reset }
//     mode: normal | error500 | forbidden | badjson | redirect | slow (uses delayMs) | hang
//     closeFirst: N  -> closes the first N open tickets (to trigger the lifecycle guard)
//     reset: true    -> restore the initial data
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const KEY = "mock-key-123";
const DAY = 86_400_000;

let state;
function reset(ticketCount = 40) {
  const now = Date.now();
  const tickets = Array.from({ length: ticketCount }, (_, i) => {
    const n = i + 1;
    const created = now - (ticketCount - i) * 0.6 * DAY - 3_600_000;
    const solved = n % 3 === 0;
    const waiting = n % 5 === 0 && !solved;
    const resolvedAt = solved ? created + 5 * 3_600_000 : null;
    return {
      id: `T-${1000 + n}`,
      subject: `Mock ticket ${n}: ${["Login fails", "Invoice question", "Export is slow", "Feature request", "Password reset"][i % 5]}`,
      created_at: new Date(created).toISOString(),
      updated_at: new Date(resolvedAt ?? created + 3_600_000).toISOString(),
      resolved_at: resolvedAt ? new Date(resolvedAt).toISOString() : null,
      state: solved ? "solved" : waiting ? "waiting" : "open",
      priority: ["p1", "p2", "p3", "p4"][i % 4],
      account: { id: `A-${(i % 6) + 1}`, name: `Mock Customer ${(i % 6) + 1}`, contact_email: `private-${n}@example.test` },
      labels: i % 2 ? ["billing"] : ["bug", "web"],
      source: ["email", "chat", "web"][i % 3],
      internal_notes: `SECRET-INTERNAL-${n}`, // must never be stored: it is not mapped
    };
  });
  state = { mode: "normal", delayMs: 0, tickets };
}
reset();

function comments(t) {
  const created = Date.parse(t.created_at);
  const out = [
    { id: `${t.id}-c1`, at: new Date(created + 20_000).toISOString(), author: { type: "requester", name: "Customer" }, public: true, body: `<p>Hello, I need help with: ${t.subject}</p>` },
    { id: `${t.id}-c2`, at: new Date(created + 1_800_000).toISOString(), author: { type: "agent", name: "Agent Ada" }, public: true, body: "Thanks, looking into it." },
    { id: `${t.id}-c3`, at: new Date(created + 2_000_000).toISOString(), author: { type: "agent", name: "Agent Ada" }, public: false, body: "internal: customer is on legacy plan" },
  ];
  if (t.state !== "open") out.push({ id: `${t.id}-c4`, at: new Date(created + 4_000_000).toISOString(), author: { type: "requester", name: "Customer" }, public: true, body: "Thanks, that works." });
  return out;
}

function history(t) {
  const created = Date.parse(t.created_at);
  const entries = [{ id: `${t.id}-h1`, at: new Date(created + 600_000).toISOString(), from: "new", to: "open" }];
  if (t.state === "waiting") entries.push({ id: `${t.id}-h2`, at: new Date(created + 3_000_000).toISOString(), from: "open", to: "waiting" });
  if (t.state === "solved") {
    entries.push({ id: `${t.id}-h2`, at: new Date(created + 3_000_000).toISOString(), from: "open", to: "waiting" });
    entries.push({ id: `${t.id}-h3`, at: new Date(created + 4_500_000).toISOString(), from: "waiting", to: "open" });
    entries.push({ id: `${t.id}-h4`, at: t.resolved_at, from: "open", to: "solved" });
  }
  return entries;
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const log = (extra = "") => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname}${url.search} ${extra}`);

  if (url.pathname === "/__state") return json(res, 200, { mode: state.mode, delayMs: state.delayMs, tickets: state.tickets.length, open: state.tickets.filter((t) => t.state !== "solved").length });
  if (url.pathname === "/__control" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (body.reset) reset(body.ticketCount ?? 40);
    else if (body.ticketCount) reset(body.ticketCount);
    if (body.mode) state.mode = body.mode;
    if (body.delayMs !== undefined) state.delayMs = body.delayMs;
    if (body.closeFirst) {
      let n = body.closeFirst;
      for (const t of state.tickets) {
        if (n > 0 && t.state !== "solved") {
          t.state = "solved";
          t.resolved_at = new Date(Date.now() - 60_000).toISOString();
          t.updated_at = new Date().toISOString();
          n -= 1;
        }
      }
    }
    log("control");
    return json(res, 200, { mode: state.mode, delayMs: state.delayMs, tickets: state.tickets.length });
  }

  if (req.headers["x-api-key"] !== KEY) { log("401"); return json(res, 401, { error: "bad key" }); }
  if (state.mode === "forbidden") { log("403"); return json(res, 403, { error: "forbidden" }); }
  if (state.mode === "error500") { log("500"); return json(res, 500, { error: "boom" }); }
  if (state.mode === "redirect") { log("302"); res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }); return res.end(); }
  if (state.mode === "badjson") { log("badjson"); res.writeHead(200, { "content-type": "application/json" }); return res.end("{not json"); }
  if (state.mode === "hang") { log("hang"); return; }
  if (state.delayMs > 0) await sleep(state.delayMs);

  if (url.pathname === "/v2/tickets") {
    const perPage = Math.min(Number(url.searchParams.get("per_page") ?? 10) || 10, 100);
    const since = url.searchParams.get("updated_after");
    const sinceMs = since ? Date.parse(since) : 0;
    const list = state.tickets.filter((t) => !sinceMs || Date.parse(t.updated_at) >= sinceMs);
    const start = Number(url.searchParams.get("cursor") ?? 0) || 0;
    const page = list.slice(start, start + perPage);
    const next = start + perPage < list.length ? String(start + perPage) : null;
    log(`-> ${page.length} tickets, next=${next}`);
    return json(res, 200, { data: page, meta: { next_cursor: next } });
  }
  const m = url.pathname.match(/^\/v2\/tickets\/([^/]+)\/(comments|history)$/);
  if (m) {
    const t = state.tickets.find((x) => x.id === decodeURIComponent(m[1]));
    if (!t) return json(res, 404, { error: "not found" });
    log("child");
    return json(res, 200, m[2] === "comments" ? { comments: comments(t) } : { entries: history(t) });
  }
  json(res, 404, { error: "no such route" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock helpdesk on http://127.0.0.1:${PORT} (key ${KEY})`));
