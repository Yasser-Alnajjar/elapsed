// Preloaded into benchmark worker processes (`node --import <this file>`): answers
// https://api.linear.app/graphql from memory, after a configurable delay, so the
// real Linear adapter, cursor handling, cycle and database code run end to end
// without any network or credentials. Everything else about `fetch` is untouched.
//
//   BENCH_PROVIDER_LATENCY_MS   mean per-request latency (default 150; +/-30% jitter)
//   BENCH_ISSUES_PER_ORG        issues returned per poll (default 2)
//   BENCH_PROVIDER_LOG          file to append one JSON line per request (start/end)
import { appendFileSync } from "node:fs";

const realFetch = globalThis.fetch;
const latency = Number(process.env.BENCH_PROVIDER_LATENCY_MS ?? 150);
const issuesPerOrg = Number(process.env.BENCH_ISSUES_PER_ORG ?? 2);
const logFile = process.env.BENCH_PROVIDER_LOG;

const page = (nodes) => ({ nodes, pageInfo: { hasNextPage: false } });

// Fixed content per issue: re-fetching the same issue hashes identically, so the
// RawEvent upsert dedupes instead of the table growing with every poll.
function issue(token, n) {
  return {
    id: `iss-${token}-${n}`,
    identifier: `B-${n}`,
    title: `Bench issue ${n}`,
    url: `https://linear.example/${token}/${n}`,
    priority: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    state: { id: "s1", name: "In Progress", type: "started" },
    team: { id: "t1", key: "B", name: "Bench" },
    creator: null,
    assignee: null,
  };
}

function log(entry) {
  if (logFile) appendFileSync(logFile, JSON.stringify(entry) + "\n");
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.linear.app/graphql")) return realFetch(input, init);

  const token = String(init?.headers?.Authorization ?? "").replace("Bearer ", "");
  const { query, variables } = JSON.parse(init.body);
  const op = query.includes("issues(") ? "issues" : query.includes("history") ? "history" : "attachments";
  const id = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  log({ t: Date.now(), pid: process.pid, token, op, phase: "start", id, updatedSince: variables.updatedSince });
  await new Promise((resolve) => setTimeout(resolve, latency * (0.7 + Math.random() * 0.6)));
  log({ t: Date.now(), pid: process.pid, token, op, phase: "end", id });

  let data;
  if (op === "issues") data = { issues: page(Array.from({ length: issuesPerOrg }, (_, n) => issue(token, n))) };
  else if (op === "history") data = { issue: { history: page([]) } };
  else data = { issue: { attachments: page([]) } };
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};
