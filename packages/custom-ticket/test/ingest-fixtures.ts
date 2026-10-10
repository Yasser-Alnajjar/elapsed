import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Local fixture helpdesk plus config builder for the ingest run tests. Needs CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1. */
export interface Fixture {
  server: Server;
  baseUrl: string;
  /** Cursor values requested from the listing, in order (a repeated first page has no cursor). */
  requested: (string | null)[];
  close: () => Promise<void>;
}

export type Handler = (cursor: string | null, req: IncomingMessage, res: ServerResponse) => boolean | void;

export function ticket(i: number, overrides: Record<string, unknown> = {}) {
  const created = Date.parse("2026-09-01T00:00:00Z") + i * 60_000;
  return {
    id: `T-${i}`,
    subject: `Ticket ${i}`,
    created_at: new Date(created).toISOString(),
    updated_at: new Date(created + 600_000).toISOString(),
    resolved_at: null,
    state: "open",
    priority: "p3",
    account: { id: `A-${i % 3}`, name: `Customer ${i % 3}` },
    labels: [],
    source: "web",
    ...overrides,
  };
}

/** Serves `tickets` in pages of `pageSize` with an opaque cursor; `handler` may take over a request first (return true). */
export async function startFixture(tickets: unknown[], pageSize: number, handler?: Handler): Promise<Fixture> {
  const requested: (string | null)[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cursor = url.searchParams.get("cursor");
    requested.push(cursor);
    if (handler?.(cursor, req, res)) return;
    const start = cursor ? Number(cursor) : 0;
    const page = tickets.slice(start, start + pageSize);
    const next = start + pageSize < tickets.length ? String(start + pageSize) : null;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: page, meta: { next_cursor: next } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    requested,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

/** The mock-helpdesk config without child requests, bearer auth, pointing at the fixture. */
export function fixtureConfig(baseUrl: string, pageSize: number, options: { incremental?: boolean } = {}): Record<string, any> {
  const path = fileURLToPath(new URL("../dev/mock-helpdesk-config.json", import.meta.url));
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.connection.baseUrl = baseUrl;
  raw.auth = { type: "bearer" }; // secrets: { token }
  delete raw.comments;
  delete raw.commentMapping;
  delete raw.statusHistory;
  raw.slaMode = "resolution_only";
  raw.tickets.pagination.pageSize = pageSize;
  if (!options.incremental) {
    delete raw.tickets.incremental;
    delete raw.tickets.request.query.updated_after;
  }
  return raw;
}
